import { getSupabase, waitForAuthSession } from "./supabase.js";
import { emailProblem, safeNextPath } from "./auth-email.js";
import {
  accountDetectedForEmail,
  rememberEmailAccount,
  resumeEmailHandoff,
  sendEmailLinkAuto,
} from "./email-handoff.js";

export { emailProblem, safeNextPath };

export function authPanelHtml(_mode = "login") {
  return `
    <div class="auth-card" role="dialog" aria-modal="true" aria-label="Log in or sign up">
      <h2 class="auth-title">Create an account</h2>
      <p class="auth-lede">Email only. No password. We pick log in or sign up from your email.</p>
      <form class="auth-form">
        <label class="auth-label">
          Email
          <input class="auth-email" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@email.com">
        </label>
        <p class="auth-error" role="alert" hidden></p>
        <button class="auth-submit" type="submit">Email me a link</button>
        <p class="auth-status" role="status" hidden></p>
      </form>
      <div class="auth-account" hidden>
        <p class="auth-account-email">Signed in as <strong class="auth-email-label"></strong></p>
        <div class="auth-account-actions">
          <a class="auth-submit auth-settings" href="/settings.html">Settings</a>
          <button class="auth-submit auth-sign-out" type="button" data-sign-out>Sign out</button>
        </div>
      </div>
    </div>
  `;
}

export function bindEmailAuth(root, { initialMode = "login" } = {}) {
  if (!root) return;
  void initialMode;
  const form = root.querySelector(".auth-form");
  const account = root.querySelector(".auth-account");
  const emailInput = root.querySelector(".auth-email");
  const errorEl = root.querySelector(".auth-error");
  const statusEl = root.querySelector(".auth-status");

  const showError = (message) => {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  };
  const showStatus = (message) => {
    statusEl.textContent = message || "";
    statusEl.hidden = !message;
  };

  const paintMode = () => {
    const known = accountDetectedForEmail(emailInput?.value || "");
    const title = root.querySelector(".auth-title");
    if (title && account.hidden) {
      title.textContent = known ? "Log in" : "Create an account";
    }
  };
  paintMode();

  emailInput?.addEventListener("input", () => {
    showError("");
    paintMode();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showStatus("");
    const email = emailInput.value.trim();
    const problem = emailProblem(email);
    if (problem) {
      showError(problem);
      emailInput.focus();
      return;
    }
    paintMode();
    const button = form.querySelector(".auth-submit");
    button.disabled = true;
    const nextPath = safeNextPath(location.search);
    try {
      showError("");
      const { whenSignedIn } = await sendEmailLinkAuto({ email, nextPath });
      showStatus("Check your email. This page signs you in when you open the link.");
      button.disabled = false;
      const session = await whenSignedIn;
      if (session?.replaced) return;
      if (session?.user) {
        rememberEmailAccount(session.user.email || email);
        location.href = nextPath;
        return;
      }
      showStatus("");
      showError("That email link expired. Request a new one.");
    } catch (err) {
      showStatus("");
      showError(err?.message || "Could not send the email.");
    } finally {
      button.disabled = false;
    }
  });

  root.querySelector("[data-sign-out]")?.addEventListener("click", async () => {
    const sb = await getSupabase();
    await sb.auth.signOut();
    location.reload();
  });

  resumeEmailHandoff(safeNextPath(location.search)).then((session) => {
    if (session?.user) location.href = safeNextPath(location.search);
  });

  waitForAuthSession()
    .then((session) => {
      const email = session?.user?.email;
      if (!email) return;
      rememberEmailAccount(email);
      form.hidden = true;
      const lede = root.querySelector(".auth-card > .auth-lede");
      if (lede) lede.hidden = true;
      account.hidden = false;
      root.querySelector(".auth-email-label").textContent = email;
      root.querySelector(".auth-title").textContent = "Your account";
      root.querySelector(".auth-card")?.setAttribute("aria-label", "Your account");
    })
    .catch(() => {});

  return {
    focus() {
      if (account && !account.hidden) return;
      emailInput?.focus();
    },
  };
}
