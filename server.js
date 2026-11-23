const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_EMAIL = "faijraja28@gmail.com";
const allowedOrigins = new Set([
  "https://form-fill-mitra.web.app",
  "https://form-fill-mitra.firebaseapp.com",
  "https://faijraja786.github.io"
]);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 100, standardHeaders: "draft-7", legacyHeaders: false }));

let firebaseReady = false;
let db = null;
try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    firebaseReady = true;
  }
} catch (error) {
  console.error("Firebase Admin initialization failed:", error.message);
}

const now = () => new Date().toISOString();
const clean = value => String(value == null ? "" : value).trim();
const fail = (res, status, message) => res.status(status).json({ error: message });
const safeDoc = snap => ({ id: snap.id, ...snap.data() });

async function requireUser(req, res, next) {
  if (!firebaseReady || !db) return fail(res, 503, "Backend authentication is not configured. Ask the administrator to configure Firebase service credentials.");
  const match = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return fail(res, 401, "Authentication required.");
  try {
    req.user = await admin.auth().verifyIdToken(match[1]);
    const profileSnap = await db.collection("profiles").doc(req.user.uid).get();
    req.profile = profileSnap.exists ? profileSnap.data() : null;
    return next();
  } catch (error) {
    console.error("Authentication failed:", error.message);
    return fail(res, 401, "Invalid or expired sign-in session.");
  }
}

function requireProfile(req, res, next) {
  if (!req.profile) return fail(res, 403, "Complete account setup before using this feature.");
  if (req.profile.status === "disabled") return fail(res, 403, "This account has been disabled. Contact support.");
  return next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.profile || !roles.includes(req.profile.role)) return fail(res, 403, "You do not have permission to perform this action.");
    next();
  };
}
async function writeAudit(actor, action, entityType, entityId, metadata = {}) {
  if (!db) return;
  await db.collection("auditLogs").add({
    actorUid: actor.uid,
    actorEmail: actor.email || "",
    actorRole: actor.role || "unknown",
    action, entityType, entityId: entityId || null,
    metadata, createdAt: now()
  });
}
function validFields(fields) {
  return Array.isArray(fields) && fields.length <= 150 && fields.every(field =>
    field && typeof field === "object" &&
    clean(field.label).length > 0 &&
    clean(field.type).length > 0 &&
    clean(field.label).length <= 160
  );
}
function applicationAccess(req, appData) {
  if (req.profile.role === "admin") return true;
  if (req.profile.role === "personal") return appData.userId === req.user.uid;
  if (req.profile.role === "professional") return appData.professionalId === req.user.uid;
  if (req.profile.role === "staff") return appData.assignedStaffId === req.user.uid;
  return false;
}

app.get("/", (_req, res) => res.json({ name: "Form Fill Mitra API", status: "ok", health: "/health" }));
app.get("/health", (_req, res) => res.status(200).json({
  status: "ok", service: "form-fill-mitra-api",
  firebaseAdminConfigured: firebaseReady,
  database: firebaseReady ? "connected" : "not-configured"
}));

// Account role is assigned once on first authenticated use. The administrator identity is fixed server-side.
app.post("/api/profile/bootstrap", requireUser, async (req, res) => {
  try {
    const ref = db.collection("profiles").doc(req.user.uid);
    const existing = await ref.get();
    if (existing.exists) return res.json({ profile: { id: req.user.uid, ...existing.data() } });
    const email = clean(req.user.email).toLowerCase();
    const requested = clean(req.body && req.body.role).toLowerCase();
    const role = email === ADMIN_EMAIL ? "admin" : (["personal", "professional"].includes(requested) ? requested : "");
    if (!role) return fail(res, 400, "Choose Personal or Professional account type before continuing.");
    const profile = {
      uid: req.user.uid, email, name: clean(req.body && req.body.name) || clean(req.user.name),
      role, status: "active", createdAt: now(), updatedAt: now()
    };
    await ref.create(profile);
    await writeAudit({ ...req.user, role }, "account.created", "profile", req.user.uid);
    return res.status(201).json({ profile: { id: req.user.uid, ...profile } });
  } catch (error) {
    console.error("Profile bootstrap failed:", error.message);
    return fail(res, 500, "Could not initialize account.");
  }
});

app.get("/api/me", requireUser, requireProfile, (req, res) => res.json({
  profile: { id: req.user.uid, email: req.user.email, ...req.profile }
}));

app.patch("/api/me", requireUser, requireProfile, async (req, res) => {
  const allowed = ["name", "phone", "address", "dateOfBirth", "education"];
  const updates = {};
  for (const key of allowed) if (req.body && req.body[key] !== undefined) updates[key] = req.body[key];
  if (updates.name !== undefined && clean(updates.name).length > 120) return fail(res, 400, "Name is too long.");
  updates.updatedAt = now();
  try {
    await db.collection("profiles").doc(req.user.uid).set(updates, { merge: true });
    await writeAudit(req.profile, "profile.updated", "profile", req.user.uid, { fields: Object.keys(updates) });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Profile update failed:", error.message);
    return fail(res, 500, "Could not update profile.");
  }
});

// Forms: published forms are visible to signed-in applicants; only admins can manage the catalogue.
app.get("/api/forms", requireUser, requireProfile, async (req, res) => {
  try {
    const snap = await db.collection("forms").get();
    const forms = snap.docs.map(safeDoc)
      .filter(form => req.profile.role === "admin" || form.status === "published")
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return res.json({ forms });
  } catch (error) {
    console.error("Forms read failed:", error.message);
    return fail(res, 500, "Could not load forms.");
  }
});

app.post("/api/forms", requireUser, requireProfile, requireRole("admin"), async (req, res) => {
  const body = req.body || {};
  const name = clean(body.name);
  const category = clean(body.category);
  const fields = body.fields;
  if (!name || name.length > 180 || !category || category.length > 100) return fail(res, 400, "Enter a valid form name and category.");
  if (!validFields(fields)) return fail(res, 400, "Add valid form fields. Each field needs a label and type.");
  const status = body.status === "published" ? "published" : "draft";
  const data = {
    name, category, description: clean(body.description).slice(0, 2000),
    officialLink: clean(body.officialLink).slice(0, 1000),
    fields, documents: Array.isArray(body.documents) ? body.documents.slice(0, 50) : [],
    status, version: 1, createdBy: req.user.uid, updatedBy: req.user.uid,
    createdAt: now(), updatedAt: now()
  };
  try {
    const ref = await db.collection("forms").add(data);
    await writeAudit(req.profile, "form.created", "form", ref.id, { name, status });
    return res.status(201).json({ form: { id: ref.id, ...data } });
  } catch (error) {
    console.error("Form create failed:", error.message);
    return fail(res, 500, "Could not create form.");
  }
});

app.patch("/api/forms/:id", requireUser, requireProfile, requireRole("admin"), async (req, res) => {
  const body = req.body || {};
  const updates = {};
  for (const key of ["name", "category", "description", "officialLink", "fields", "documents", "status"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (updates.name !== undefined && (!clean(updates.name) || clean(updates.name).length > 180)) return fail(res, 400, "Invalid form name.");
  if (updates.category !== undefined && (!clean(updates.category) || clean(updates.category).length > 100)) return fail(res, 400, "Invalid form category.");
  if (updates.fields !== undefined && !validFields(updates.fields)) return fail(res, 400, "Invalid form fields.");
  if (updates.status !== undefined && !["draft", "published", "archived"].includes(updates.status)) return fail(res, 400, "Invalid form status.");
  updates.updatedAt = now(); updates.updatedBy = req.user.uid;
  try {
    const ref = db.collection("forms").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, "Form not found.");
    updates.version = Number(snap.data().version || 1) + 1;
    await ref.update(updates);
    await writeAudit(req.profile, "form.updated", "form", req.params.id, { fields: Object.keys(updates) });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Form update failed:", error.message);
    return fail(res, 500, "Could not update form.");
  }
});

app.delete("/api/forms/:id", requireUser, requireProfile, requireRole("admin"), async (req, res) => {
  try {
    const ref = db.collection("forms").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, "Form not found.");
    await ref.update({ status: "archived", updatedAt: now(), updatedBy: req.user.uid });
    await writeAudit(req.profile, "form.archived", "form", req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    console.error("Form archive failed:", error.message);
    return fail(res, 500, "Could not archive form.");
  }
});

// Applications contain applicant PII. Responses are scoped by role and assignment on every request.
app.post("/api/applications", requireUser, requireProfile, async (req, res) => {
  const body = req.body || {};
  const formId = clean(body.formId);
  const applicant = body.applicant && typeof body.applicant === "object" ? body.applicant : {};
  if (!formId) return fail(res, 400, "Select a published form.");
  try {
    const formSnap = await db.collection("forms").doc(formId).get();
    if (!formSnap.exists || formSnap.data().status !== "published") return fail(res, 404, "Published form not found.");
    const form = safeDoc(formSnap);
    const professionalId = req.profile.role === "professional" ? req.user.uid : null;
    const data = {
      formId, formName: form.name, formVersion: form.version || 1,
      formSnapshot: { name: form.name, category: form.category, fields: form.fields || [] },
      userId: req.profile.role === "personal" ? req.user.uid : null,
      professionalId,
      createdBy: req.user.uid,
      applicant: {
        fullName: clean(applicant.fullName).slice(0, 160),
        email: clean(applicant.email).slice(0, 200),
        phone: clean(applicant.phone).slice(0, 40),
        address: clean(applicant.address).slice(0, 1000)
      },
      answers: body.answers && typeof body.answers === "object" ? body.answers : {},
      status: "submitted", assignedStaffId: null,
      createdAt: now(), updatedAt: now()
    };
    if (req.profile.role === "staff") return fail(res, 403, "Staff cannot create unassigned applications.");
    const ref = await db.collection("applications").add(data);
    await writeAudit(req.profile, "application.submitted", "application", ref.id, { formId });
    return res.status(201).json({ applicationId: ref.id, status: data.status });
  } catch (error) {
    console.error("Application create failed:", error.message);
    return fail(res, 500, "Could not submit application.");
  }
});

app.get("/api/applications", requireUser, requireProfile, async (req, res) => {
  try {
    let query = db.collection("applications");
    if (req.profile.role === "personal") query = query.where("userId", "==", req.user.uid);
    else if (req.profile.role === "professional") query = query.where("professionalId", "==", req.user.uid);
    else if (req.profile.role === "staff") query = query.where("assignedStaffId", "==", req.user.uid);
    const snap = await query.limit(250).get();
    const applications = snap.docs.map(safeDoc).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return res.json({ applications });
  } catch (error) {
    console.error("Applications read failed:", error.message);
    return fail(res, 500, "Could not load applications.");
  }
});

app.get("/api/applications/:id", requireUser, requireProfile, async (req, res) => {
  try {
    const snap = await db.collection("applications").doc(req.params.id).get();
    if (!snap.exists) return fail(res, 404, "Application not found.");
    const application = safeDoc(snap);
    if (!applicationAccess(req, application)) return fail(res, 403, "You do not have access to this applicant's personal details.");
    return res.json({ application });
  } catch (error) {
    console.error("Application detail failed:", error.message);
    return fail(res, 500, "Could not load application.");
  }
});

app.patch("/api/applications/:id", requireUser, requireProfile, async (req, res) => {
  const body = req.body || {};
  const updates = {};
  if (body.status !== undefined) {
    if (!["submitted", "under_review", "needs_correction", "approved", "rejected", "completed"].includes(body.status)) return fail(res, 400, "Invalid application status.");
    updates.status = body.status;
  }
  if (body.reviewNotes !== undefined) updates.reviewNotes = clean(body.reviewNotes).slice(0, 3000);
  try {
    const ref = db.collection("applications").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, "Application not found.");
    const appData = safeDoc(snap);
    if (!applicationAccess(req, appData)) return fail(res, 403, "You do not have access to this application.");
    if (!["admin", "staff"].includes(req.profile.role)) return fail(res, 403, "Only Admin or assigned Staff can update application status.");
    if (req.profile.role === "staff" && appData.assignedStaffId !== req.user.uid) return fail(res, 403, "This application is not assigned to you.");
    updates.updatedAt = now();
    await ref.update(updates);
    await writeAudit(req.profile, "application.updated", "application", req.params.id, { fields: Object.keys(updates) });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Application update failed:", error.message);
    return fail(res, 500, "Could not update application.");
  }
});

app.post("/api/applications/:id/assign", requireUser, requireProfile, requireRole("admin"), async (req, res) => {
  const staffUid = clean(req.body && req.body.staffUid);
  if (!staffUid) return fail(res, 400, "Choose a staff account.");
  try {
    const staffSnap = await db.collection("profiles").doc(staffUid).get();
    if (!staffSnap.exists || staffSnap.data().role !== "staff" || staffSnap.data().status !== "active") return fail(res, 400, "Active staff account not found.");
    const ref = db.collection("applications").doc(req.params.id);
    const appSnap = await ref.get();
    if (!appSnap.exists) return fail(res, 404, "Application not found.");
    await ref.update({ assignedStaffId: staffUid, assignedStaffEmail: staffSnap.data().email || "", updatedAt: now() });
    await writeAudit(req.profile, "application.assigned", "application", req.params.id, { staffUid });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Assignment failed:", error.message);
    return fail(res, 500, "Could not assign application.");
  }
});

// Professionals own their client directory; client records are not visible to other professionals.
app.get("/api/clients", requireUser, requireProfile, requireRole("professional"), async (req, res) => {
  try {
    const snap = await db.collection("clients").where("professionalId", "==", req.user.uid).limit(500).get();
    return res.json({ clients: snap.docs.map(safeDoc) });
  } catch (error) {
    console.error("Clients read failed:", error.message);
    return fail(res, 500, "Could not load clients.");
  }
});
app.post("/api/clients", requireUser, requireProfile, requireRole("professional"), async (req, res) => {
  const body = req.body || {};
  const name = clean(body.name);
  if (!name || name.length > 160) return fail(res, 400, "Enter a valid client name.");
  const data = {
    professionalId: req.user.uid, name,
    email: clean(body.email).slice(0, 200),
    phone: clean(body.phone).slice(0, 40),
    address: clean(body.address).slice(0, 1000),
    notes: clean(body.notes).slice(0, 1000),
    createdAt: now(), updatedAt: now()
  };
  try {
    const ref = await db.collection("clients").add(data);
    await writeAudit(req.profile, "client.created", "client", ref.id);
    return res.status(201).json({ client: { id: ref.id, ...data } });
  } catch (error) {
    console.error("Client create failed:", error.message);
    return fail(res, 500, "Could not save client.");
  }
});

app.get("/api/staff", requireUser, requireProfile, requireRole("admin"), async (_req, res) => {
  try {
    const snap = await db.collection("profiles").where("role", "==", "staff").limit(500).get();
    return res.json({ staff: snap.docs.map(safeDoc) });
  } catch (error) {
    console.error("Staff list failed:", error.message);
    return fail(res, 500, "Could not load staff.");
  }
});
app.post("/api/staff/assign-role", requireUser, requireProfile, requireRole("admin"), async (req, res) => {
  const email = clean(req.body && req.body.email).toLowerCase();
  if (!email || !email.includes("@") || email === ADMIN_EMAIL) return fail(res, 400, "Enter a valid staff email.");
  try {
    const authUser = await admin.auth().getUserByEmail(email);
    const ref = db.collection("profiles").doc(authUser.uid);
    const existing = await ref.get();
    if (existing.exists && existing.data().role === "admin") return fail(res, 403, "Administrator role cannot be changed.");
    const data = {
      uid: authUser.uid, email, name: clean(req.body.name) || authUser.displayName || "",
      role: "staff", status: "active", permissions: ["view_assigned_applications", "update_assigned_status"],
      updatedAt: now(), ...(existing.exists ? {} : { createdAt: now() })
    };
    await ref.set(data, { merge: true });
    await writeAudit(req.profile, "staff.role_assigned", "profile", authUser.uid);
    return res.json({ ok: true, staff: { id: authUser.uid, ...data } });
  } catch (error) {
    if (error.code === "auth/user-not-found") return fail(res, 404, "This person must create and verify an account before being added as staff.");
    console.error("Staff role assignment failed:", error.message);
    return fail(res, 500, "Could not assign staff role.");
  }
});

app.get("/api/audit-logs", requireUser, requireProfile, requireRole("admin"), async (req, res) => {
  try {
    const snap = await db.collection("auditLogs").orderBy("createdAt", "desc").limit(300).get();
    return res.json({ logs: snap.docs.map(safeDoc) });
  } catch (error) {
    console.error("Audit log read failed:", error.message);
    return fail(res, 500, "Could not load audit logs.");
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!file.mimetype || !/^image\/(jpeg|png|webp|tiff|bmp)$/i.test(file.mimetype)) {
      return callback(new Error("Only JPEG, PNG, WEBP, TIFF, and BMP images are supported."));
    }
    callback(null, true);
  }
});
const ocrLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });
app.post("/api/ocr/image", ocrLimiter, requireUser, upload.single("document"), async (req, res) => {
  if (!req.file) return fail(res, 400, "Upload one image in the document field.");
  let worker;
  try {
    const { createWorker } = require("tesseract.js");
    worker = await createWorker("eng+hin");
    const result = await worker.recognize(req.file.buffer);
    return res.status(200).json({ text: result.data.text || "", confidence: result.data.confidence ?? null, reviewRequired: true, message: "Please verify every extracted field against the original document." });
  } catch (error) {
    console.error("OCR processing failed:", error.message);
    return fail(res, 500, "OCR could not process this image. Please enter details manually.");
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return fail(res, error.code === "LIMIT_FILE_SIZE" ? 413 : 400, error.message);
  if (error.message === "Origin not allowed by CORS") return fail(res, 403, "This website origin is not allowed.");
  if (error.message && error.message.startsWith("Only JPEG")) return fail(res, 415, error.message);
  console.error("Request failed:", error.message);
  return fail(res, 400, "Request could not be processed.");
});

app.listen(PORT, "0.0.0.0", () => console.log(`Form Fill Mitra API listening on port ${PORT}`));
