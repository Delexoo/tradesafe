import { api, ensureGuest } from "./api-client.js";

const status = document.getElementById("status");
try {
  await ensureGuest();
  const { profile, is_guest } = await api("/api/profile");
  if (status) {
    status.textContent = is_guest
      ? `Guest session · ${profile?.display_name || "Guest"}`
      : `Signed in · ${profile?.display_name || ""}`;
  }
} catch (err) {
  if (status) status.textContent = err.message || "Could not load settings";
}
