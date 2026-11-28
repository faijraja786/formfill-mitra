const summary = document.getElementById("summary");
const status = document.getElementById("status");
async function refresh() {
  const { ffmPendingAutofill: data } = await chrome.storage.local.get("ffmPendingAutofill");
  if (!data) { summary.textContent = "No application data received. Complete Final Review in Form Fill Mitra first."; return; }
  const age = Math.max(0, Math.round((Date.now() - data.createdAt) / 60000));
  summary.textContent = "Ready: " + (data.formName || "Application") + "\nData saved " + age + " minute(s) ago. Use only on the intended official portal.";
}
document.getElementById("fill").addEventListener("click", async () => {
  status.textContent = "Reading this page and matching fields…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !/^https?:/.test(tab.url || "")) throw new Error("Open the official application portal first.");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["portal-autofill.js"] });
    status.textContent = "Autofill started. Check the report on the portal page; nothing will be submitted automatically.";
  } catch (e) { status.textContent = e.message || "Could not run autofill on this tab."; }
});
document.getElementById("clear").addEventListener("click", async () => {
  await chrome.storage.local.remove("ffmPendingAutofill");
  status.textContent = "Saved application data cleared from extension storage.";
  refresh();
});
refresh();