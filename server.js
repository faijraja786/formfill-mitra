const express = require("express");
const cors = require("cors");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 10000;
const allowedOrigins = new Set([
  "https://form-fill-mitra.web.app",
  "https://form-fill-mitra.firebaseapp.com",
  "https://faijraja786.github.io"
]);

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "32kb" }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));

let firebaseReady = false;
try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseReady = true;
  }
} catch (error) {
  console.error("Firebase Admin initialization failed:", error.message);
}

async function requireUser(req, res, next) {
  if (!firebaseReady) {
    return res.status(503).json({ error: "Backend authentication is not configured yet." });
  }
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "Authentication required." });
  try {
    req.user = await admin.auth().verifyIdToken(match[1]);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired sign-in session." });
  }
}

app.get("/", (_req, res) => res.json({ name: "Form Fill Mitra API", status: "ok" }));
app.get("/health", (_req, res) => res.json({
  status: "ok",
  service: "form-fill-mitra-api",
  firebaseAdminConfigured: firebaseReady
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return callback(new Error("Only image files are supported for OCR currently."));
    }
    callback(null, true);
  }
});

app.post("/api/ocr/image", requireUser, upload.single("document"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Upload one image in the document field." });
  let worker;
  try {
    const { createWorker } = require("tesseract.js");
    worker = await createWorker("eng+hin");
    const result = await worker.recognize(req.file.buffer);
    return res.json({
      text: result.data.text || "",
      confidence: result.data.confidence ?? null,
      reviewRequired: true,
      message: "Please verify every extracted field against the original document."
    });
  } catch (error) {
    console.error("OCR processing failed:", error.message);
    return res.status(500).json({ error: "OCR could not process this image. Please enter details manually." });
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
});

app.use((error, _req, res, _next) => {
  const status = error instanceof multer.MulterError ? 400 : 400;
  res.status(status).json({ error: error.message || "Request could not be processed." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Form Fill Mitra API listening on port ${PORT}`);
});
