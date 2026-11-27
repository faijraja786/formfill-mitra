import { auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

export const API_BASE = "https://form-fill-mitra-api.onrender.com";

export async function apiRequest(path, options = {}) {
  const user = auth.currentUser || await new Promise(resolve => {
    let unsubscribe = () => {};
    unsubscribe = onAuthStateChanged(auth, currentUser => {
      unsubscribe();
      resolve(currentUser);
    }, () => resolve(null));
  });
  if (!user) throw new Error("Please sign in again.");
  const token = await user.getIdToken();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + token);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(API_BASE + path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
  return payload;
}

export async function bootstrapProfile(role, name = "") {
  return apiRequest("/api/profile/bootstrap", {
    method: "POST",
    body: JSON.stringify({ role, name })
  });
}
