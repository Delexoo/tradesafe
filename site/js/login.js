import { getSupabase } from "./supabase.js";

const form = document.getElementById("login-form");
const errorEl = document.getElementById("error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.classList.add("hidden");
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  try {
    const sb = await getSupabase();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const params = new URLSearchParams(location.search);
    location.href = params.get("next") || "/dashboard.html";
  } catch (err) {
    errorEl.textContent = err.message || "Sign in failed";
    errorEl.classList.remove("hidden");
  }
});
