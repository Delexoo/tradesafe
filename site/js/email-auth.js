import { getSession, getSupabase } from "./supabase.js";
import { emailProblem, safeNextPath } from "./email-auth-check.js";
import { resumeEmailHandoff, sendEmailLink } from "./email-handoff.js";

export { emailProblem, safeNextPath };

export function authPanelHtml(mode = "login") {
  const loginOn = mode !== "signup";
  return `
    <div class="auth-card" role="dialog" aria-modal="true" aria-label="Log in or sign up">
      <h2 class="auth-title">Log in or sign up</h2>
      <p class="auth-lede">Email only. No password.</p>
      <div class="auth-tabs" role="tablist" aria-label="Account">
        <button type="button" class="auth-tab" role="tab" data-auth-mode="login" aria-selected="${loginOn}">Log in</button>
        <button type="button" class="auth-tab" role="tab" data-auth-mode="signup" aria-selected="${!loginOn}">Sign up</button>
      </div>
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
        <p class="auth-lede">Signed in as <strong class="auth-email-label"></strong></p>
        <button class="auth-submit" type="button" data-sign-out>Sign out</button>
      </div>
    </div>
  `;
}

export function bindEmailAuth(root, { initialMode = "login" } = {}) {
  if (!root) return;
  let mode = initialMode === "signup" ? "signup" : "login";
  const form = root.querySelector(".auth-form");
  const account = root.querySelector(".auth-account");
  const emailInput = root.querySelector(".auth-email");
  const errorEl = root.querySelector(".auth-error");
  const statusEl = root.querySelector(".auth-status");
  const tabs = [...root.querySelectorAll(".auth-tab")];

  const showError = (message) => {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  };
  const showStatus = (message) => {
    statusEl.textContent = message || "";
    statusEl.hidden = !message;
  };

  const paintMode = () => {
    for (const tab of tabs) {
      tab.setAttribute("aria-selected", String(tab.dataset.authMode === mode));
    }
  };
  paintMode();

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      mode = tab.dataset.authMode === "signup" ? "signup" : "login";
      paintMode();
      showError("");
      showStatus("");
      emailInput?.focus();
    });
  }

  emailInput?.addEventListener("input", () => showError(""));

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
    const button = form.querySelector(".auth-submit");
    button.disabled = true;
    const nextPath = safeNextPath(location.search);
    try {
      showError("");
      const { whenSignedIn } = await sendEmailLink({
        email,
        shouldCreateUser: mode === "signup",
        nextPath,
      });
      showStatus("Check your email. This page signs you in when you open the link.");
      button.disabled = false;
      const session = await whenSignedIn;
      if (session?.replaced) return;
      if (session?.user) {
        location.href = nextPath;
        return;
      }
      showStatus("");
      showError("That email link expired. Request a new one.");
    } catch (err) {
      showStatus("");
      const text = err?.message || "Could not send the email.";
      if (mode === "login" && /signups not allowed|user not found|not found/i.test(text)) {
        showError("No account for that email yet. Use Sign up.");
      } else {
        showError(text);
      }
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

  getSession()
    .then((session) => {
      const email = session?.user?.email;
      if (!email) return;
      form.hidden = true;
      root.querySelector(".auth-tabs").hidden = true;
      account.hidden = false;
      root.querySelector(".auth-email-label").textContent = email;
      root.querySelector(".auth-title").textContent = "Your account";
    })
    .catch(() => {});

  return {
    focus() {
      if (account && !account.hidden) return;
      emailInput?.focus();
    },
  };
}
