import { api } from "./api-client.js";
import { deliveryForCategory, problemsForStep } from "./create-form.js";
import { platformFeeCents, sellerNetCents } from "./platform-fees.js";
import { money } from "./format.js";
import { enhanceSelects } from "./listbox.js";
import { policyCheckboxHtml, wirePolicyGate } from "./policy-checkbox.js";
import { getSupabase, waitForAuthSession } from "./supabase.js";
import {
  accountDetectedForEmail,
  readEmailHandoffStored,
  rememberEmailAccount,
  resumeEmailHandoff,
  sendEmailLinkForMode,
} from "./email-handoff.js";
import { emailProblem } from "./auth-email.js";

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

document.getElementById("policy-box").innerHTML = policyCheckboxHtml({ wizard: true });
const policyGate = wirePolicyGate(
  document.getElementById("policy-accept"),
  null,
  errorEl,
);

enhanceSelects(form);

function syncRoleThumb() {
  const group = document.querySelector("#create-form .choice-segment");
  if (!group) return;
  group.dataset.role = roleInput.value;
}

document.querySelectorAll("#create-form [data-role]").forEach((btn) => {
  btn.addEventListener("click", () => {
    roleInput.value = btn.dataset.role;
    document.querySelectorAll("#create-form [data-role]").forEach((el) => {
      const on = el === btn;
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", String(on));
    });
    syncRoleThumb();
  });
});
syncRoleThumb();

function values() {
  return {
    title: document.getElementById("title").value,
    amount: document.getElementById("amount").value,
    "display-name": document.getElementById("display-name").value,
    "policy-accept": document.getElementById("policy-accept").checked,
    category: document.getElementById("category").value,
    domain_name: document.getElementById("domain-name")?.value,
    preview_url: document.getElementById("preview-url")?.value,
    service_scope: document.getElementById("service-scope")?.value,
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

function paintCategoryPanels() {
  const category = document.getElementById("category").value;
  const ship = ["physical", "electronics", "collectibles"].includes(category);
  for (const panel of document.querySelectorAll("[data-cat-panel]")) {
    const key = panel.getAttribute("data-cat-panel");
    const on =
      (key === "ship" && ship) ||
      (key === "digital" && category === "digital") ||
      (key === "website_domain" && category === "website_domain") ||
      (key === "service" && category === "service");
    panel.hidden = !on;
  }
  const carrierWrap = document.getElementById("carrier-wrap");
  if (carrierWrap) {
    carrierWrap.hidden = document.getElementById("ship-mode")?.value === "other";
  }
}

function paintFeeHint() {
  const hint = document.getElementById("fee-hint");
  if (!hint) return;
  const amount = Number(document.getElementById("amount").value || 0);
  const currency = document.getElementById("currency").value || "usd";
  if (!Number.isFinite(amount) || amount < 0.01) {
    hint.textContent =
      "Buyer pays the listed amount. Seller receives that amount minus TradeSafe’s fee (2.9% + $0.30). Stripe processes the payment.";
    return;
  }
  const cents = Math.round(amount * 100);
  const fee = platformFeeCents(cents);
  const net = sellerNetCents(cents);
  hint.textContent = `Buyer pays ${money(cents, currency)}. Seller receives about ${money(net, currency)} after TradeSafe’s fee of ${money(fee, currency)} (2.9% + $0.30). Stripe processes the payment.`;
}

function buildTerms() {
  const category = document.getElementById("category").value;
  const terms = { category };
  if (["physical", "electronics", "collectibles"].includes(category)) {
    terms.ship_mode = document.getElementById("ship-mode").value;
    const carrier = document.getElementById("carrier-name").value.trim();
    if (carrier) terms.carrier_name = carrier;
  }
  if (category === "digital") {
    terms.digital_kind = document.getElementById("digital-kind").value;
    const preview = document.getElementById("preview-url").value.trim();
    if (preview) terms.preview_url = preview;
  }
  if (category === "website_domain") {
    terms.domain_name = document.getElementById("domain-name").value.trim();
    const registrar = document.getElementById("registrar").value.trim();
    const notes = document.getElementById("domain-notes").value.trim();
    if (registrar) terms.registrar = registrar;
    if (notes) terms.domain_notes = notes;
  }
  if (category === "service") {
    terms.service_scope = document.getElementById("service-scope").value.trim();
  }
  return terms;
}

function showStep() {
  panes.forEach((pane, index) => {
    const on = index === step;
    pane.hidden = !on;
    pane.querySelectorAll("input, select, textarea, button").forEach((el) => {
      if (el.id === "role") return;
      if (el.classList.contains("listbox-trigger")) {
        el.disabled = !on;
        return;
      }
      el.disabled = !on;
    });
  });
  document.getElementById("step-label").textContent = `${step + 1} of ${panes.length}`;
  document.getElementById("step-title").textContent = STEP_TITLES[step];
  back.hidden = step === 0;
  next.textContent = step === panes.length - 1 ? "Create trade" : "Next";
  errorEl.classList.add("hidden");
  if (step === 0) paintFeeHint();
  if (step === 1) paintCategoryPanels();
  if (step === panes.length - 1) refreshPayout();
}

form.addEventListener("input", (event) => {
  if (event.target?.id) clearField(event.target.id);
  if (event.target?.id === "amount" || event.target?.id === "currency") paintFeeHint();
});
form.addEventListener("change", (event) => {
  if (event.target?.id) clearField(event.target.id);
  if (event.target?.id === "category") {
    document.getElementById("delivery").value = deliveryForCategory(event.target.value);
    document.getElementById("delivery").dispatchEvent(new Event("change", { bubbles: true }));
    paintCategoryPanels();
  }
  if (event.target?.id === "ship-mode") paintCategoryPanels();
  if (event.target?.id === "currency") paintFeeHint();
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
      err.message || "Add a Stripe payout account before creating this trade.";
    return;
  }
  const amount = Number(document.getElementById("amount").value || 0);
  const currency = document.getElementById("currency").value || "usd";
  const cents = Math.round(amount * 100);
  const feeLine =
    Number.isFinite(amount) && amount >= 0.01
      ? ` Your share of this trade is about ${money(sellerNetCents(cents), currency)} after the ${money(platformFeeCents(cents), currency)} TradeSafe fee.`
      : "";
  document.getElementById("payout-status").textContent = payoutReady
    ? `Payout account ready. Stripe sends your share there after the buyer confirms.${feeLine} TradeSafe does not hold the money.`
    : `Add a Stripe payout account (bank or debit). Stripe sends your share there after the buyer confirms.${feeLine} TradeSafe never stores your card for receiving money and does not hold the funds.`;
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
      ship_mode: document.getElementById("ship-mode")?.value,
      carrier_name: document.getElementById("carrier-name")?.value,
      digital_kind: document.getElementById("digital-kind")?.value,
      preview_url: document.getElementById("preview-url")?.value,
      domain_name: document.getElementById("domain-name")?.value,
      registrar: document.getElementById("registrar")?.value,
      domain_notes: document.getElementById("domain-notes")?.value,
      service_scope: document.getElementById("service-scope")?.value,
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
    if (document.getElementById("ship-mode") && draft.ship_mode) {
      document.getElementById("ship-mode").value = draft.ship_mode;
    }
    if (document.getElementById("carrier-name")) {
      document.getElementById("carrier-name").value = draft.carrier_name || "";
    }
    if (document.getElementById("digital-kind") && draft.digital_kind) {
      document.getElementById("digital-kind").value = draft.digital_kind;
    }
    if (document.getElementById("preview-url")) {
      document.getElementById("preview-url").value = draft.preview_url || "";
    }
    if (document.getElementById("domain-name")) {
      document.getElementById("domain-name").value = draft.domain_name || "";
    }
    if (document.getElementById("registrar")) {
      document.getElementById("registrar").value = draft.registrar || "";
    }
    if (document.getElementById("domain-notes")) {
      document.getElementById("domain-notes").value = draft.domain_notes || "";
    }
    if (document.getElementById("service-scope")) {
      document.getElementById("service-scope").value = draft.service_scope || "";
    }
    form.querySelectorAll("select.field").forEach((el) => {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if (draft.role === "buyer" || draft.role === "seller") {
      document.querySelector(`[data-role="${draft.role}"]`)?.click();
    }
    step = Number.isInteger(draft.step) ? Math.min(Math.max(draft.step, 0), panes.length - 1) : 0;
    paintCategoryPanels();
    paintFeeHint();
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
        terms: buildTerms(),
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
  const gate = document.getElementById("account-gate");
  gate.classList.add("hidden");
  gate.setAttribute("hidden", "");
  wizard.classList.remove("hidden");
  wizard.removeAttribute("hidden");
  if (session?.user?.email) rememberEmailAccount(session.user.email);
  const name = document.getElementById("display-name");
  if (!name.value) {
    name.value = session.user.user_metadata?.display_name || session.user.email?.split("@")[0] || "";
  }
  if (new URLSearchParams(location.search).get("payout") === "return") step = panes.length - 1;
  restoreDraft();
  showStep();
}

let accountMode = "signup";

function setAccountMode(mode, { paint = true } = {}) {
  accountMode = mode === "login" ? "login" : "signup";
  const group = document.getElementById("account-mode");
  if (group) group.dataset.mode = accountMode;
  for (const btn of group?.querySelectorAll("button[data-mode]") || []) {
    const on = btn.getAttribute("data-mode") === accountMode;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  }
  if (paint) paintAccountGate();
}

function paintAccountGate() {
  const title = document.getElementById("account-title");
  const note = document.getElementById("account-note");
  const submit = document.getElementById("account-submit");
  const login = accountMode === "login";
  if (title) title.textContent = login ? "Log in" : "Create an account";
  if (note) {
    note.textContent = login
      ? "Welcome back. Email a login link to continue creating this trade."
      : "New here? Sign up with email. Already have an account? Switch to Log in.";
  }
  if (submit) submit.textContent = login ? "Email me a login link" : "Email me a signup link";
}

function showAccountGate() {
  const gate = document.getElementById("account-gate");
  gate.classList.remove("hidden");
  gate.removeAttribute("hidden");
  document.getElementById("account-checking")?.remove();
  accountForm?.classList.remove("hidden");
  const email = accountEmail?.value || "";
  setAccountMode(accountDetectedForEmail(email) ? "login" : "signup");
  const pending = readEmailHandoffStored();
  if (pending?.nextPath === "/create.html" && accountStatus) {
    accountStatus.textContent =
      "Check your email. This page signs you in when you open the link.";
    accountStatus.classList.remove("hidden");
  }
}

function showCheckingGate() {
  const gate = document.getElementById("account-gate");
  const title = document.getElementById("account-title");
  const note = document.getElementById("account-note");
  if (title) title.textContent = "One moment";
  if (note) note.textContent = "Checking if you are already signed in…";
  let checking = document.getElementById("account-checking");
  if (!checking) {
    checking = document.createElement("p");
    checking.id = "account-checking";
    checking.className = "note";
    checking.hidden = true;
    gate.insertBefore(checking, accountForm);
  }
  accountForm?.classList.add("hidden");
}

const accountForm = document.getElementById("account-form");
const accountEmail = document.getElementById("account-email");
const accountError = document.getElementById("account-error");
const accountStatus = document.getElementById("account-status");
const accountModeGroup = document.getElementById("account-mode");

accountModeGroup?.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-mode]");
  if (!btn || !accountModeGroup.contains(btn)) return;
  event.preventDefault();
  accountError?.classList.add("hidden");
  accountStatus?.classList.add("hidden");
  setAccountMode(btn.getAttribute("data-mode"));
});

accountEmail?.addEventListener("input", () => {
  accountError.classList.add("hidden");
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
  paintAccountGate();
  const button = document.getElementById("account-submit");
  button.disabled = true;
  try {
    const { whenSignedIn, mode, switched } = await sendEmailLinkForMode({
      email,
      nextPath: "/create.html",
      mode: accountMode,
    });
    if (switched && mode === "login") {
      setAccountMode("login");
      accountStatus.textContent =
        "That email already has an account. We sent a login link instead.";
    } else {
      accountStatus.textContent =
        accountMode === "login"
          ? "Check your email. Open the login link to continue this trade."
          : "Check your email. Open the signup link to create your account and continue.";
    }
    accountStatus.classList.remove("hidden");
    button.disabled = false;
    const session = await whenSignedIn;
    if (session?.replaced) return;
    if (session?.user) {
      openWizard(session);
      return;
    }
    accountStatus.classList.add("hidden");
    accountError.textContent = "That email link expired. Request a new one.";
    accountError.classList.remove("hidden");
  } catch (err) {
    accountStatus.classList.add("hidden");
    if (err?.code === "NO_ACCOUNT") {
      setAccountMode("signup");
    }
    accountError.textContent = err.message || "Could not send the email.";
    accountError.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});

document.documentElement.dataset.createReady = "1";
showCheckingGate();

async function enterIfSignedIn() {
  const session = await waitForAuthSession();
  if (session?.user) {
    openWizard(session);
    return true;
  }
  return false;
}

async function bootCreateGate() {
  try {
    if (await enterIfSignedIn()) return;
  } catch (err) {
    console.error(err);
  }
  // Show login/signup immediately — never block the form on a pending email poll.
  showAccountGate();
  resumeEmailHandoff("/create.html").then((handed) => {
    if (handed?.replaced) return;
    if (handed?.user) openWizard(handed);
  });
  try {
    const sb = await getSupabase();
    sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user) openWizard(session);
    });
  } catch (err) {
    console.error(err);
  }
}

bootCreateGate();
