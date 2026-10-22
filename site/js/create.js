import { api } from "./api-client.js";
import { problemsForStep } from "./create-form.js";
import { policyCheckboxHtml, wirePolicyGate } from "./policy-checkbox.js";
import { getSession, getSupabase } from "./supabase.js";
import { emailProblem } from "./email-auth-check.js";

const STEP_TITLES = ["Name the trade", "Describe it", "Choose your side", "Agree and create"];
const form = document.getElementById("create-form");
const next = document.getElementById("next");
const back = document.getElementById("back");
const errorEl = document.getElementById("error");
const wizard = document.getElementById("wizard");
const roleInput = document.getElementById("role");
const panes = [...document.querySelectorAll("[data-pane]")];
const DRAFT_KEY = "ts-create-draft";
let step = 0;
let payoutReady = false;
let accountMode = "signup";

document.getElementById("policy-box").innerHTML = policyCheckboxHtml({ wizard: true });
const policyGate = wirePolicyGate(
  document.getElementById("policy-accept"),
  null,
  errorEl,
  document.getElementById("device-optional"),
);

document.querySelectorAll("[data-role]").forEach((btn) => {
  btn.addEventListener("click", () => {
    roleInput.value = btn.dataset.role;
    document.querySelectorAll("[data-role]").forEach((el) => {
      const on = el === btn;
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", String(on));
    });
  });
});

function values() {
  return {
    title: document.getElementById("title").value,
    amount: document.getElementById("amount").value,
    "display-name": document.getElementById("display-name").value,
    "policy-accept": document.getElementById("policy-accept").checked,
  };
}

function clearField(id) {
  const el = document.getElementById(id);
  const err = document.querySelector(`[data-error-for="${id}"]`);
  el?.classList.remove("is-invalid");
  el?.removeAttribute("aria-invalid");
  if (err) {
    err.textContent = "";
    err.classList.add("hidden");
  }
}

function showFieldError(id, message) {
  const el = document.getElementById(id);
  const err = document.querySelector(`[data-error-for="${id}"]`);
  el?.classList.add("is-invalid");
  el?.setAttribute("aria-invalid", "true");
  if (err) {
    err.textContent = message;
    err.classList.remove("hidden");
  }
}

function validate() {
  const problems = problemsForStep(step, values());
  const pane = panes[step];
  for (const node of pane.querySelectorAll("[data-error-for]")) {
    const id = node.getAttribute("data-error-for");
    if (!problems.some((p) => p.id === id)) clearField(id);
  }
  if (!problems.length) {
    errorEl.classList.add("hidden");
    return true;
  }
  for (const problem of problems) showFieldError(problem.id, problem.message);
  errorEl.textContent =
    problems.length === 1 ? problems[0].message : "Fill out the highlighted fields.";
  errorEl.classList.remove("hidden");
  document.getElementById(problems[0].id)?.focus();
  return false;
}

function showStep() {
  panes.forEach((pane, index) => {
    const on = index === step;
    pane.hidden = !on;
    pane.querySelectorAll("input, select, textarea, button").forEach((el) => {
      if (el.id === "role") return;
      el.disabled = !on;
    });
  });
  document.getElementById("step-label").textContent = `${step + 1} of ${panes.length}`;
  document.getElementById("step-title").textContent = STEP_TITLES[step];
  back.hidden = step === 0;
  next.textContent = step === panes.length - 1 ? "Create trade" : "Next";
  errorEl.classList.add("hidden");
  if (step === panes.length - 1) refreshPayout();
}

form.addEventListener("input", (event) => {
  if (event.target?.id) clearField(event.target.id);
});
form.addEventListener("change", (event) => {
  if (event.target?.id) clearField(event.target.id);
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  next.click();
});

back.addEventListener("click", () => {
  step = Math.max(0, step - 1);
  showStep();
});

async function refreshPayout() {
  const box = document.getElementById("payout-box");
  const seller = roleInput.value === "seller";
  box.hidden = !seller;
  if (!seller) {
    payoutReady = true;
    return;
  }
  try {
    const status = await api("/api/payouts");
    payoutReady = !!status.ready;
  } catch (err) {
    payoutReady = false;
    document.getElementById("payout-status").textContent =
      err.message || "Add where you get paid before creating this trade.";
    return;
  }
  document.getElementById("payout-status").textContent = payoutReady
    ? "Payout account added. Stripe sends you the payment. TradeSafe does not hold the money."
    : "Add where you get paid. Stripe sends the money there. TradeSafe does not hold it.";
  document.getElementById("payout-btn").hidden = payoutReady;
}

function saveDraft() {
  sessionStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      title: document.getElementById("title").value,
      amount: document.getElementById("amount").value,
      currency: document.getElementById("currency").value,
      category: document.getElementById("category").value,
      delivery: document.getElementById("delivery").value,
      description: document.getElementById("description").value,
      role: roleInput.value,
      name: document.getElementById("display-name").value,
      step,
    }),
  );
}

function restoreDraft() {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    document.getElementById("title").value = draft.title || "";
    document.getElementById("amount").value = draft.amount || "";
    document.getElementById("currency").value = draft.currency || "usd";
    document.getElementById("category").value = draft.category || "other";
    document.getElementById("delivery").value = draft.delivery || "other";
    document.getElementById("description").value = draft.description || "";
    document.getElementById("display-name").value = draft.name || "";
    if (draft.role === "buyer" || draft.role === "seller") {
      document.querySelector(`[data-role="${draft.role}"]`)?.click();
    }
    step = Number.isInteger(draft.step) ? Math.min(Math.max(draft.step, 0), panes.length - 1) : 0;
  } catch {
    sessionStorage.removeItem(DRAFT_KEY);
  }
}

document.getElementById("payout-btn").addEventListener("click", async () => {
  const button = document.getElementById("payout-btn");
  button.disabled = true;
  saveDraft();
  try {
    const result = await api("/api/payouts/link", {
      method: "POST",
      body: JSON.stringify({ returnPath: "/create.html?payout=return" }),
    });
    if (!result.url) throw new Error("Could not open the payout account. Try again.");
    location.href = result.url;
  } catch (err) {
    document.getElementById("payout-status").textContent =
      err.message || "Could not open the payout account. Try again.";
    button.disabled = false;
  }
});

next.addEventListener("click", async () => {
  if (!validate()) return;
  if (step === panes.length - 1 && roleInput.value === "seller" && !payoutReady) {
    errorEl.textContent = "Add where you get paid before creating this trade.";
    errorEl.classList.remove("hidden");
    return;
  }
  if (step < panes.length - 1) {
    step += 1;
    showStep();
    return;
  }
  try {
    policyGate.assertAccepted();
  } catch {
    return;
  }

  next.disabled = true;
  try {
    const amount = Number(document.getElementById("amount").value || 0);
    const result = await api("/api/trades", {
      method: "POST",
      body: JSON.stringify({
        title: document.getElementById("title").value.trim(),
        description: document.getElementById("description").value.trim(),
        amount_cents: Math.round(amount * 100),
        currency: document.getElementById("currency").value,
        category: document.getElementById("category").value,
        delivery_method: document.getElementById("delivery").value,
        creator_role: roleInput.value,
        terms: {},
        display_name: document.getElementById("display-name").value.trim(),
        acceptedRequired: true,
        acceptedOptionalDevice: policyGate.optionalDeviceAccepted(),
        acceptedPolicies: true,
      }),
    });
    sessionStorage.removeItem(DRAFT_KEY);
    wizard.classList.add("hidden");
    document.getElementById("created").classList.remove("hidden");
    const url = `${location.origin}${result.inviteUrl}`;
    document.getElementById("invite-url").value = url;
    document.getElementById("open-room").href = `/room.html?id=${result.transaction.id}`;
    document.getElementById("copy-invite").onclick = async () => {
      const status = document.getElementById("copy-status");
      try {
        await navigator.clipboard.writeText(url);
        status.textContent = "Invite link copied.";
      } catch {
        status.textContent = "Select the link and copy it manually.";
      }
    };
  } catch (err) {
    errorEl.textContent = err.message || "Could not create trade";
    errorEl.classList.remove("hidden");
    next.disabled = false;
  }
});

function openWizard(session) {
  document.getElementById("account-gate").classList.add("hidden");
  wizard.classList.remove("hidden");
  const name = document.getElementById("display-name");
  if (!name.value) {
    name.value = session.user.user_metadata?.display_name || session.user.email?.split("@")[0] || "";
  }
  if (new URLSearchParams(location.search).get("payout") === "return") step = panes.length - 1;
  restoreDraft();
  showStep();
}

const accountForm = document.getElementById("account-form");
const accountEmail = document.getElementById("account-email");
const accountError = document.getElementById("account-error");
const accountStatus = document.getElementById("account-status");
document.getElementById("account-switch").addEventListener("click", () => {
  accountMode = accountMode === "signup" ? "login" : "signup";
  document.getElementById("account-switch").textContent =
    accountMode === "signup" ? "I already have an account" : "I need to create an account";
  document.querySelector("#account-gate h1").textContent =
    accountMode === "signup" ? "Create an account" : "Log in";
  accountError.classList.add("hidden");
  accountStatus.classList.add("hidden");
});
accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = accountEmail.value.trim();
  const problem = emailProblem(email);
  accountError.classList.add("hidden");
  accountStatus.classList.add("hidden");
  if (problem) {
    accountError.textContent = problem;
    accountError.classList.remove("hidden");
    accountEmail.focus();
    return;
  }
  const button = document.getElementById("account-submit");
  button.disabled = true;
  try {
    const sb = await getSupabase();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: accountMode === "signup",
        emailRedirectTo: `${location.origin}/create.html`,
      },
    });
    if (error) throw error;
    accountStatus.textContent =
      accountMode === "signup"
        ? "Check your email for a link to create your account."
        : "Check your email for a link to log in.";
    accountStatus.classList.remove("hidden");
  } catch (err) {
    accountError.textContent = err.message || "Could not send the email.";
    accountError.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});

document.documentElement.dataset.createReady = "1";
const session = await getSession();
if (session?.user) openWizard(session);
