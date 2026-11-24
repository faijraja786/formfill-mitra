const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

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
let supabaseStorage = null;
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabaseStorage = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
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
    if (req.user.email_verified !== true) return fail(res, 403, "Verify your email address before using this service.");
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
  const allowedTypes = new Set(["text", "email", "tel", "number", "date", "textarea", "select"]);
  return Array.isArray(fields) && fields.length > 0 && fields.length <= 150 && fields.every(field =>
    field && typeof field === "object" &&
    clean(field.label).length > 0 && clean(field.label).length <= 160 &&
    allowedTypes.has(clean(field.type)) &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(clean(field.key)) &&
    (field.type !== "select" || (Array.isArray(field.options) && field.options.length > 0 && field.options.length <= 100))
  );
}
function validDocuments(documents) {
  if (!Array.isArray(documents) || documents.length > 50) return false;
  const seen = new Set();
  return documents.every((item) => {
    if (typeof item === "string") return clean(item).length > 0 && clean(item).length <= 160;
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const key = clean(item.key);
    const label = clean(item.label);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key) || !label || label.length > 160) return false;
    if (item.required !== undefined && typeof item.required !== "boolean") return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applicationAccess(req, appData) {
  if (req.profile.role === "admin") return true;
  if (req.profile.role === "personal") return appData.userId === req.user.uid;
  if (req.profile.role === "professional") return appData.professionalId === req.user.uid;
  if (req.profile.role === "staff") return appData.assignedStaffId === req.user.uid;
  return false;
}

async function seedBiharRtpsForms() {
  if (!db) return;
  const sharedFields = [
    { key: "full_name", label: "Applicant Full Name (as per records)", type: "text", required: true, options: [] },
    { key: "father_name", label: "Father / Guardian Name", type: "text", required: true, options: [] },
    { key: "dob", label: "Date of Birth", type: "date", required: false, options: [] },
    { key: "gender", label: "Gender", type: "select", required: true, options: ["Male", "Female", "Other"] },
    { key: "mobile", label: "Mobile Number", type: "tel", required: true, options: [] },
    { key: "email", label: "Email Address", type: "email", required: false, options: [] },
    { key: "state", label: "State", type: "text", required: true, options: [] },
    { key: "district", label: "District", type: "text", required: true, options: [] },
    { key: "block_circle", label: "Block / Circle", type: "text", required: true, options: [] },
    { key: "village_ward", label: "Village / Ward", type: "text", required: true, options: [] },
    { key: "full_address", label: "Full Residential Address", type: "textarea", required: true, options: [] },
    { key: "application_purpose", label: "Purpose of Certificate", type: "textarea", required: true, options: [] }
  ];
  const definitions = [
    {
      id: "bihar-income-certificate",
      name: "Bihar Income Certificate",
      category: "Bihar RTPS",
      description: "Guided preparation for the Bihar Income Certificate service. Select the correct issuing level and verify current requirements on the official ServicePlus portal before applying.",
      officialLink: "https://serviceonline.bihar.gov.in/",
      documents: [
        { key: "identity_proof", label: "Identity Proof", required: false },
        { key: "photograph", label: "Recent Photograph", required: false },
        { key: "address_proof", label: "Address Proof", required: false },
        { key: "income_support", label: "Income Supporting Document", required: false },
        { key: "self_declaration", label: "Self-declaration / Other Supporting Record", required: false }
      ],
      fields: [...sharedFields, { key: "occupation", label: "Occupation", type: "text", required: true, options: [] }, { key: "annual_family_income", label: "Approximate Annual Family Income (INR)", type: "number", required: true, options: [] }, { key: "income_source", label: "Main Source of Income", type: "textarea", required: true, options: [] }]
    },
    {
      id: "bihar-residential-certificate",
      name: "Bihar Residential Certificate",
      category: "Bihar RTPS",
      description: "Guided preparation for the Bihar Residential Certificate service. Choose the appropriate Circle, Sub-Division or District level and confirm document requirements on the official portal.",
      officialLink: "https://serviceonline.bihar.gov.in/",
      fields: [...sharedFields, { key: "residence_since", label: "Since when have you lived at this address?", type: "text", required: true, options: [] }, { key: "residence_proof_type", label: "Available Residence Proof", type: "text", required: false, options: [] }]
    },
    {
      id: "bihar-caste-certificate",
      name: "Bihar Caste Certificate",
      category: "Bihar RTPS",
      description: "Guided preparation for the Bihar Caste Certificate service. Confirm the eligible category, issuing level and current supporting-document list on the official portal.",
      officialLink: "https://serviceonline.bihar.gov.in/",
      fields: [...sharedFields, { key: "caste_community", label: "Caste / Community Name (as recorded)", type: "text", required: true, options: [] }, { key: "category", label: "Category", type: "select", required: true, options: ["BC", "EBC", "SC", "ST", "Other / As per official list"] }, { key: "caste_proof_type", label: "Available Supporting Record", type: "text", required: false, options: [] }]
    }
  ];
  for (const form of definitions) {
    const ref = db.collection("forms").doc(form.id);
    const existing = await ref.get();
    if (!existing.exists) {
      await ref.create({
        ...form, documents: form.documents || [], status: "published", version: 1,
        systemSeed: "bihar-rtps-v1", createdBy: "system",
        updatedBy: "system", createdAt: now(), updatedAt: now()
      });
    } else if (
      form.id === "bihar-income-certificate" &&
      existing.data().systemSeed === "bihar-rtps-v1" &&
      (!Array.isArray(existing.data().documents) || existing.data().documents.length === 0)
    ) {
      await ref.update({ documents: form.documents, updatedAt: now() });
    }
  }
}

app.get("/", (_req, res) => res.json({ name: "Form Fill Mitra API", status: "ok", health: "/health" }));
app.get("/health", async (_req, res) => {
  let database = "not-configured";
  let storage = supabaseStorage ? "checking" : "not-configured";
  if (firebaseReady && db) {
    try {
      await db.collection("_healthChecks").doc("connectivity").get();
      database = "connected";
    } catch (error) {
      database = "unavailable";
    }
  }
  if (supabaseStorage) {
    try {
      const { data: buckets, error } = await supabaseStorage.storage.listBuckets();
      if (error) throw error;
      storage = (buckets || []).some(item => item.name === "applicant-documents") ? "connected" : "bucket-missing";
    } catch (error) {
      console.error("Supabase Storage health check failed:", error.message);
      storage = "unavailable";
    }
  }
  return res.status(200).json({
    status: "ok", service: "form-fill-mitra-api",
    firebaseAdminConfigured: firebaseReady,
    database, storage
  });
});

// Account role is assigned once on first authenticated use. The administrator identity is fixed server-side.
app.post("/api/profile/bootstrap", requireUser, async (req, res) => {
  try {
    const ref = db.collection("profiles").doc(req.user.uid);
    const existing = await ref.get();
    const email = clean(req.user.email).toLowerCase();
    if (existing.exists) {
      const oldProfile = existing.data();
      if (email === ADMIN_EMAIL) {
        if (oldProfile.role !== "admin") {
          await ref.set({ role: "admin", status: "active", email, updatedAt: now() }, { merge: true });
        }
        await seedBiharRtpsForms();
        const refreshed = await ref.get();
        return res.json({ profile: { id: req.user.uid, ...refreshed.data() } });
      }
      return res.json({ profile: { id: req.user.uid, ...oldProfile } });
    }
    const requested = clean(req.body && req.body.role).toLowerCase();
    const role = email === ADMIN_EMAIL ? "admin" : (["personal", "professional"].includes(requested) ? requested : "");
    if (!role) return fail(res, 400, "Choose Personal or Professional account type before continuing.");
    const profile = {
      uid: req.user.uid, email, name: clean(req.body && req.body.name) || clean(req.user.name),
      role, status: "active", createdAt: now(), updatedAt: now()
    };
    await ref.create(profile);
    await writeAudit({ ...req.user, role }, "account.created", "profile", req.user.uid);
    if (role === "admin") await seedBiharRtpsForms();
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
    if (req.profile.role === "admin") await seedBiharRtpsForms();
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
  const documents = body.documents === undefined ? [] : body.documents;
  if (!validDocuments(documents)) return fail(res, 400, "Add a valid document checklist. Each item needs a unique key and label.");
  const status = body.status === "published" ? "published" : "draft";
  const data = {
    name, category, description: clean(body.description).slice(0, 2000),
    officialLink: clean(body.officialLink).slice(0, 1000),
    fields, documents,
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
  if (updates.documents !== undefined && !validDocuments(updates.documents)) return fail(res, 400, "Invalid document checklist.");
  if (updates.officialLink !== undefined && clean(updates.officialLink)) {
    try {
      const url = new URL(clean(updates.officialLink));
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported protocol");
    } catch (_) {
      return fail(res, 400, "Official portal link must be a valid HTTPS or HTTP URL.");
    }
  }
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
  const answers = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : {};
  const answerValue = (...keys) => {
    for (const key of keys) {
      const value = answers[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return "";
  };
  if (!formId) return fail(res, 400, "Select a published form.");
  try {
    const formSnap = await db.collection("forms").doc(formId).get();
    if (!formSnap.exists || formSnap.data().status !== "published") return fail(res, 404, "Published form not found.");
    const form = safeDoc(formSnap);
    const professionalId = req.profile.role === "professional" ? req.user.uid : null;
    const clientId = req.profile.role === "professional" ? clean(body.clientId) : "";
    if (clientId) {
      const clientSnap = await db.collection("clients").doc(clientId).get();
      if (!clientSnap.exists || clientSnap.data().professionalId !== req.user.uid) {
        return fail(res, 403, "The selected client does not belong to your professional account.");
      }
    }
    const data = {
      formId, formName: form.name, formVersion: form.version || 1,
      formSnapshot: { name: form.name, category: form.category, fields: form.fields || [] },
      userId: req.profile.role === "personal" ? req.user.uid : null,
      professionalId,
      createdBy: req.user.uid,
      clientId: clientId || null,
      applicant: {
        fullName: clean(applicant.fullName || applicant.name || answerValue("full_name", "fullname", "name", "applicant_name", "candidate_name")).slice(0, 160),
        email: clean(applicant.email || answerValue("email", "email_address")).slice(0, 200),
        phone: clean(applicant.phone || applicant.mobile || applicant.mobileNumber || answerValue("mobile", "mobile_number", "phone", "phone_number", "contact_number")).slice(0, 40),
        address: clean(applicant.address || answerValue("full_address", "address", "permanent_address", "present_address")).slice(0, 1000),
        dateOfBirth: clean(applicant.dateOfBirth || applicant.dob || answerValue("dob", "date_of_birth", "birth_date")).slice(0, 40),
        gender: clean(applicant.gender || answerValue("gender", "sex")).slice(0, 40),
        category: clean(applicant.category || answerValue("category", "caste_category", "reservation_category")).slice(0, 80),
        guardianName: clean(applicant.guardianName || applicant.fatherName || answerValue("father_name", "guardian_name", "father")).slice(0, 160),
        education: clean(applicant.education || applicant.qualification || answerValue("education", "qualification", "education_details")).slice(0, 1000)
      },
      answers,
      status: "preparation", assignedStaffId: null,
      createdAt: now(), updatedAt: now()
    };
    if (req.profile.role === "staff") return fail(res, 403, "Staff cannot create unassigned applications.");
    const ref = await db.collection("applications").add(data);
    await writeAudit(req.profile, "application.created", "application", ref.id, { formId, status: data.status });
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
    if (!["preparation", "submitted", "portal_submitted", "under_review", "needs_correction", "approved", "rejected", "completed"].includes(body.status)) return fail(res, 400, "Invalid application status.");
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

// Private application document storage. Files are never made public; every read is authorized here.
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(String(file.mimetype || "").toLowerCase())) {
      return callback(new Error("Only PDF, JPEG, PNG, and WEBP documents are supported."));
    }
    callback(null, true);
  }
});

function detectDocumentMime(buffer) {
  if (!buffer || buffer.length < 12) return "";
  if (buffer.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return "";
}
function safeFileName(value) {
  const base = clean(value).replace(/[\\/\\?%*:|"<>\\x00-\\x1f]/g, "_").slice(0, 120);
  return base || "document";
}
async function getAccessibleApplication(req, applicationId) {
  const snap = await db.collection("applications").doc(applicationId).get();
  if (!snap.exists) return null;
  const data = safeDoc(snap);
  return applicationAccess(req, data) ? { ref: snap.ref, data } : false;
}
function publicDocument(doc) {
  return {
    id: doc.id, documentKey: doc.documentKey, name: doc.name,
    mimeType: doc.mimeType, size: doc.size, createdAt: doc.createdAt
  };
}

app.get("/api/applications/:id/documents", requireUser, requireProfile, async (req, res) => {
  try {
    const application = await getAccessibleApplication(req, req.params.id);
    if (application === false) return fail(res, 403, "You do not have access to these documents.");
    if (!application) return fail(res, 404, "Application not found.");
    const snap = await application.ref.collection("documents").orderBy("createdAt", "desc").limit(100).get();
    return res.json({ documents: snap.docs.map(doc => publicDocument({ id: doc.id, ...doc.data() })) });
  } catch (error) {
    console.error("Application documents list failed:", error.message);
    return fail(res, 500, "Could not load application documents.");
  }
});

app.post("/api/applications/:id/documents", requireUser, requireProfile, documentUpload.single("document"), async (req, res) => {
  if (!req.file) return fail(res, 400, "Choose one document to upload.");
  if (!supabaseStorage) return fail(res, 503, "Private document storage is not configured yet.");
  const mimeType = detectDocumentMime(req.file.buffer);
  if (!mimeType || mimeType !== req.file.mimetype) return fail(res, 415, "The file content does not match its declared type.");
  const documentKey = clean(req.body && req.body.documentKey);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(documentKey)) return fail(res, 400, "Invalid document type.");
  try {
    const application = await getAccessibleApplication(req, req.params.id);
    if (application === false) return fail(res, 403, "You do not have access to this application.");
    if (!application) return fail(res, 404, "Application not found.");
    if (!["personal", "professional", "admin"].includes(req.profile.role)) return fail(res, 403, "This account cannot upload applicant documents.");
    const id = crypto.randomUUID();
    const name = safeFileName(req.file.originalname);
    const extension = mimeType === "application/pdf" ? "pdf" : mimeType.split("/")[1];
    const storagePath = "private-applications/" + req.params.id + "/" + id + "." + extension;
    const { error: storageError } = await supabaseStorage.storage
      .from("applicant-documents")
      .upload(storagePath, req.file.buffer, {
        contentType: mimeType,
        cacheControl: "0",
        upsert: false
      });
    if (storageError) throw storageError;
    const metadata = {
      documentKey, name, mimeType, size: req.file.size, storagePath,
      uploadedBy: req.user.uid, createdAt: now()
    };
    const docRef = await application.ref.collection("documents").add(metadata);
    await writeAudit(req.profile, "document.uploaded", "application_document", docRef.id, { applicationId: req.params.id, documentKey });
    return res.status(201).json({ document: publicDocument({ id: docRef.id, ...metadata }) });
  } catch (error) {
    console.error("Document upload failed:", error.message);
    return fail(res, 500, "Document could not be stored securely. Please try again.");
  }
});

app.get("/api/applications/:id/documents/:documentId/download", requireUser, requireProfile, async (req, res) => {
  if (!supabaseStorage) return fail(res, 503, "Private document storage is not configured yet.");
  try {
    const application = await getAccessibleApplication(req, req.params.id);
    if (application === false) return fail(res, 403, "You do not have access to this document.");
    if (!application) return fail(res, 404, "Application not found.");
    const docSnap = await application.ref.collection("documents").doc(req.params.documentId).get();
    if (!docSnap.exists) return fail(res, 404, "Document not found.");
    const doc = docSnap.data();
    const { data: fileData, error: storageError } = await supabaseStorage.storage
      .from("applicant-documents")
      .download(doc.storagePath);
    if (storageError || !fileData) return fail(res, 404, "Stored document is unavailable.");
    res.set({
      "Content-Type": doc.mimeType || "application/octet-stream",
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(safeFileName(doc.name)),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff"
    });
    const fileBuffer = Buffer.from(await fileData.arrayBuffer());
    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error("Document download authorization failed:", error.message);
    return fail(res, 500, "Could not download document.");
  }
});

app.delete("/api/applications/:id/documents/:documentId", requireUser, requireProfile, async (req, res) => {
  if (!supabaseStorage) return fail(res, 503, "Private document storage is not configured yet.");
  try {
    const application = await getAccessibleApplication(req, req.params.id);
    if (application === false) return fail(res, 403, "You do not have access to this document.");
    if (!application) return fail(res, 404, "Application not found.");
    const isOwner = ["personal", "professional"].includes(req.profile.role);
    const canDelete = req.profile.role === "admin" || (isOwner && !["approved", "completed"].includes(application.data.status));
    if (!canDelete) return fail(res, 403, "You cannot delete documents from this application.");
    const ref = application.ref.collection("documents").doc(req.params.documentId);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, "Document not found.");
    const doc = snap.data();
    if (supabaseStorage && doc.storagePath) {
      const { error: storageError } = await supabaseStorage.storage.from("applicant-documents").remove([doc.storagePath]);
      if (storageError) throw storageError;
    }
    await ref.delete();
    await writeAudit(req.profile, "document.deleted", "application_document", req.params.documentId, { applicationId: req.params.id });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Document deletion failed:", error.message);
    return fail(res, 500, "Could not delete document.");
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
  if (error.message && (error.message.startsWith("Only JPEG") || error.message.startsWith("Only PDF"))) return fail(res, 415, error.message);
  console.error("Request failed:", error.message);
  return fail(res, 400, "Request could not be processed.");
});

app.listen(PORT, "0.0.0.0", () => console.log(`Form Fill Mitra API listening on port ${PORT}`));
