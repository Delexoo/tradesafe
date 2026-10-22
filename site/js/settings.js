import { api } from "./api-client.js";
import { emailProblem } from "./auth-email.js";
import {
  accountDetectedForEmail,
  rememberEmailAccount,
  resumeEmailHandoff,
  sendEmailLinkAuto,
} from "./email-handoff.js";
import { getSession, getSupabase } from "./supabase.js";

const authGate = document.getElementById("auth-gate");
const accountSettings = document.getElementById("account-settings");
const authTitle = document.getElementById("auth-title");
const authLede = document.getElementById("auth-lede");
const authForm = document.getElementById("auth-form");
const authEmail = document.getElementById("auth-email");
const authError = document.getElementById("auth-error");
const authStatus = document.getElementById("auth-status");
const authSubmit = document.getElementById("auth-submit");
const lede = document.getElementById("settings-lede");
const nameInput = document.getElementById("display-name");
const emailValue = document.getElementById("email-value");
const profileForm = document.getElementById("profile-form");
const profileStatus = document.getElementById("profile-status");
const profileError = document.getElementById("profile-error");
const payoutStatus = document.getElementById("payout-status");
const payoutBtn = document.getElementById("payout-btn");
const payoutHint = document.getElementById("payout-hint");
const sessionNote = document.getElementById("session-note");
const signOutBtn = document.getElementById("sign-out");

function show(el, on = true) {
  if (!el) return;
  el.hidden = !on;
}

function setText(el, text) {
  if (el) el.textContent = text || "";
}

function flash(el, message) {
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("hidden", !message);
}

function paintAuthMode(email = "") {
  const known = accountDetectedForEmail(email);
  setText(authTitle, known ? "Log in" : "Create an account");
  setText(
    authLede,
    known
      ? "Welcome back. Email a link to open your settings."
      : "We email you a link. No password. Settings unlock after you verify your email.",
  );
}

function showAuthGate() {
  show(authGate, true);
  show(accountSettings, false);
  paintAuthMode(authEmail?.value || "");
}

function showAccountSettings() {
  show(authGate, false);
  show(accountSettings, true);
}

async function loadPayout() {
  try {
    const { ready } = await api("/api/payouts");
    setText(
      payoutStatus,
      ready
        ? "Payout account is connected. Stripe can send seller funds there after the buyer confirms."
        : "No payout account yet. Add one before you create a trade as the seller.",
    );
    setText(payoutBtn, ready ? "Update payout account" : "Add payout account");
    show(payoutBtn, true);
    show(payoutHint, true);
  } catch (err) {
    setText(payoutStatus, err.message || "Could not load payout status.");
    show(payoutBtn, false);
    show(payoutHint, false);
  }
}

async function loadAccount() {
  const { profile, email } = await api("/api/profile");
  if (email) rememberEmailAccount(email);
  nameInput.value = profile?.display_name || "";
  setText(emailValue, email || "—");
  setText(lede, "Manage your TradeSafe account.");
  setText(sessionNote, `Signed in as ${email || profile?.display_name || "your account"}.`);
  await loadPayout();
}

authEmail?.addEventListener("input", () => {
  flash(authError, "");
  paintAuthMode(authEmail.value);
});

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  flash(authError, "");
  flash(authStatus, "");
  const email = authEmail.value.trim();
  const problem = emailProblem(email);
  if (problem) {
    flash(authError, problem);
    authEmail.focus();
    return;
  }
  paintAuthMode(email);
  authSubmit.disabled = true;
  try {
    const { whenSignedIn } = await sendEmailLinkAuto({
      email,
      nextPath: "/settings.html",
    });
    flash(authStatus, "Check your email. This page opens settings when you open the link.");
    authSubmit.disabled = false;
    const session = await whenSignedIn;
    if (session?.replaced) return;
    if (session?.user) {
      rememberEmailAccount(session.user.email || email);
      showAccountSettings();
      await loadAccount();
      return;
    }
    flash(authStatus, "");
    flash(authError, "That email link expired. Request a new one.");
  } catch (err) {
    flash(authStatus, "");
    flash(authError, err?.message || "Could not send the email.");
  } finally {
    authSubmit.disabled = false;
  }
});

profileForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  flash(profileError, "");
  flash(profileStatus, "");
  const display_name = String(nameInput.value || "").trim().slice(0, 80);
  if (!display_name) {
    flash(profileError, "Enter a display name.");
    nameInput.focus();
    return;
  }
  const button = document.getElementById("profile-save");
  button.disabled = true;
  try {
    const { profile } = await api("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ display_name }),
    });
    nameInput.value = profile?.display_name || display_name;
    flash(profileStatus, "Display name saved.");
  } catch (err) {
    flash(profileError, err.message || "Could not save.");
  } finally {
    button.disabled = false;
  }
});

payoutBtn?.addEventListener("click", async () => {
  payoutBtn.disabled = true;
  try {
    const { url } = await api("/api/payouts/link", {
      method: "POST",
      body: JSON.stringify({ returnPath: "/settings.html" }),
    });
    if (!url) throw new Error("Could not open the payout account.");
    location.href = url;
  } catch (err) {
    setText(payoutStatus, err.message || "Could not open payout setup.");
    payoutBtn.disabled = false;
  }
});

signOutBtn?.addEventListener("click", async () => {
  const sb = await getSupabase();
  await sb.auth.signOut();
  location.href = "/settings.html";
});

const session = await getSession();
if (session?.user?.email) {
  showAccountSettings();
  try {
    await loadAccount();
  } catch (err) {
    setText(lede, err.message || "Could not load settings.");
  }
} else {
  showAuthGate();
  resumeEmailHandoff("/settings.html").then(async (nextSession) => {
    if (!nextSession?.user) return;
    showAccountSettings();
    try {
      await loadAccount();
    } catch (err) {
      setText(lede, err.message || "Could not load settings.");
    }
  });
  const sb = await getSupabase();
  sb.auth.onAuthStateChange(async (_event, next) => {
    if (!next?.user?.email) return;
    showAccountSettings();
    try {
      await loadAccount();
    } catch {
      /* keep gate message if profile fails */
    }
  });
}
