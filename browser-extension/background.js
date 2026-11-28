const MAX_PENDING_AGE_MS = 3 * 60 * 60 * 1000;

async function tryAutofill(tabId, url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return;
    const { ffmPendingAutofill: pending } = await chrome.storage.local.get("ffmPendingAutofill");
    if (!pending || !pending.createdAt || Date.now() - pending.createdAt > MAX_PENDING_AGE_MS) {
      if (pending) await chrome.storage.local.remove("ffmPendingAutofill");
      return;
    }
    const target = new URL(pending.officialLink);
    // Automatic injection is limited to the exact origin explicitly selected
    // in Final Review and granted by the user. Other redirect domains require
    // the user to open the extension popup and approve that site.
    if (parsed.origin !== target.origin) return;
    const originPattern = parsed.origin + "/*";
    const granted = await chrome.permissions.contains({ origins: [originPattern] });
    if (!granted) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["portal-autofill.js"]
    });
  } catch (_) {
    // Unsupported pages, inaccessible tabs, or denied permissions are no-ops.
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    tryAutofill(tabId, tab.url);
  }
});
