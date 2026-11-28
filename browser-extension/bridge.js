(() => {
  "use strict";
  const APP_ORIGINS = new Set(["https://form-fill-mitra.web.app", "https://form-fill-mitra.firebaseapp.com"]);
  window.addEventListener("message", async (event) => {
    if (event.source !== window || !APP_ORIGINS.has(event.origin)) return;
    const message = event.data;
    if (!message || message.type !== "FFM_AUTOFILL_HANDOFF" || message.version !== 1) return;
    const payload = message.payload;
    if (!payload || typeof payload !== "object" || !payload.applicant || !payload.answers) return;
    try {
      await chrome.storage.local.set({
        ffmPendingAutofill: {
          version: 1,
          createdAt: Date.now(),
          formName: String(payload.formName || "Application"),
          officialLink: String(payload.officialLink || ""),
          applicant: payload.applicant,
          answers: payload.answers,
          fields: Array.isArray(payload.fields) ? payload.fields : []
        }
      });
      window.postMessage({ type: "FFM_AUTOFILL_ACK", version: 1, status: "stored" }, event.origin);
    } catch (_) {
      window.postMessage({ type: "FFM_AUTOFILL_ACK", version: 1, status: "error" }, event.origin);
    }
  });
})();