const summary = document.getElementById("summary");
const status = document.getElementById("status");
const MAX_PENDING_AGE_MS = 3 * 60 * 60 * 1000;

async function getFreshPending() {
  const { ffmPendingAutofill: data } = await chrome.storage.local.get("ffmPendingAutofill");
  if (data && (!data.createdAt || Date.now() - data.createdAt > MAX_PENDING_AGE_MS)) {
    await chrome.storage.local.remove("ffmPendingAutofill");
    return null;
  }
  return data || null;
}
async function refresh() {
  const data = await getFreshPending();
  if (!data) {
    summary.textContent = "No current application data. Complete Final Review in Form Fill Mitra first.";
    return;
  }
  const age = Math.max(0, Math.round((Date.now() - data.createdAt) / 60000));
  summary.textContent = "Ready: " + (data.formName || "Application") + "\nTemporary data expires after 3 hours.\nSaved " + age + " minute(s) ago.";
}
document.getElementById("fill").addEventListener("click", async () => {
  status.textContent = "Checking portal access…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !/^https?:/.test(tab.url || "")) throw new Error("Open the official portal first.");
    const data = await getFreshPending();
    if (!data) throw new Error("Application handoff expired or missing. Return to Form Fill Mitra and review again.");
    const current = new URL(tab.url);
    const intended = data.officialLink ? new URL(data.officialLink) : null;
    if (intended && current.origin !== intended.origin) {
      const ok = confirm("This page is on " + current.hostname + ", while Final Review selected " + intended.hostname + ". Only continue if this is the official portal/redirect you intended.");
      if (!ok) return;
    }
    const originPattern = current.origin + "/*";
    const alreadyGranted = await chrome.permissions.contains({ origins: [originPattern] });
    if (!alreadyGranted) {
      const granted = await chrome.permissions.request({ origins: [originPattern] });
      if (!granted) throw new Error("Portal access was not granted. No fields were changed.");
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["portal-autofill.js"] });
    status.textContent = "Autofill started. Review the verification report and every field. Nothing is submitted automatically.";
  } catch (e) {
    status.textContent = e.message || "Could not run autofill on this tab.";
  }
});
document.getElementById("clear").addEventListener("click", async () => {
  await chrome.storage.local.remove("ffmPendingAutofill");
  status.textContent = "Temporary application data cleared from extension storage.";
  refresh();
});
refresh();
