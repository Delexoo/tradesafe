import { requireUser, api, getSupabase } from "./supabase.js";
import { renderAppNav } from "./nav.js";

renderAppNav("settings");

const { user } = await requireUser();
const form = document.getElementById("profile-form");
const errorEl = document.getElementById("error");
const messageEl = document.getElementById("message");

try {
  const { profile, email } = await api("/api/profile");
  document.getElementById("display_name").value = profile?.display_name || "";
  document.getElementById("email").value = email || user.email || "";
} catch (err) {
  errorEl.textContent = err.message;
  errorEl.classList.remove("hidden");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.classList.add("hidden");
  messageEl.classList.add("hidden");
  try {
    await api("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({
        display_name: document.getElementById("display_name").value.trim(),
      }),
    });
    messageEl.textContent = "Saved.";
    messageEl.classList.remove("hidden");
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  }
});

document.getElementById("signout").onclick = async () => {
  const sb = await getSupabase();
  await sb.auth.signOut();
  location.href = "/";
};
