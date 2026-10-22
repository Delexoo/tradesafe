import { getSupabase } from "./supabase.js";

const form = document.getElementById("signup-form");
const errorEl = document.getElementById("error");
const messageEl = document.getElementById("message");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.classList.add("hidden");
  messageEl.classList.add("hidden");
  const display_name = document.getElementById("display_name").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { display_name } },
    });
    if (error) throw error;
    if (data.session) {
      location.href = "/dashboard.html";
      return;
    }
    messageEl.textContent =
      "Check your email to confirm your account, then log in.";
    messageEl.classList.remove("hidden");
  } catch (err) {
    errorEl.textContent = err.message || "Sign up failed";
    errorEl.classList.remove("hidden");
  }
});
