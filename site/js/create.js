import { api } from "./api-client.js?v=20261022c";
import { problemsForStep } from "./create-form.js?v=20261022c";
import { money } from "./format.js?v=20261022c";
import { policyCheckboxHtml, wirePolicyGate } from "./policy-checkbox.js?v=20261022c";

let step = 0;
const panes = [...document.querySelectorAll("[data-pane]")];
const stepEls = [...document.querySelectorAll("#steps [data-step]")];
const back = document.getElementById("back");
const next = document.getElementById("next");
const form = document.getElementById("create-form");
const errorEl = document.getElementById("error");
const wizard = document.getElementById("wizard");

const OPTION_LABELS = {
  category: {
    physical: "Physical goods",
    digital: "Digital",
    electronics: "Electronics",
    collectibles: "Collectibles",
    website_domain: "Website / domain",
    service: "Service",
    other: "Other",
  },
  delivery: {
    shipping: "Shipping",
    digital_transfer: "Digital transfer",
    pickup: "Pickup",
    in_person: "In person",
    other: "Other",
  },
  role: { seller: "Seller", buyer: "Buyer" },
};

document.getElementById("policy-box").innerHTML = policyCheckboxHtml();
const policyGate = wirePolicyGate(
  document.getElementById("policy-accept"),
  null,
  errorEl,
  document.getElementById("device-optional"),
);

function values() {
  return {
    title: document.getElementById("title").value,
    description: document.getElementById("description").value,
    amount: document.getElementById("amount").value,
    terms: document.getElementById("terms").value,
    ack: document.getElementById("ack").checked,
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

function clearStepErrors() {
  document.querySelectorAll("[data-error-for]").forEach((node) => {
    clearField(node.getAttribute("data-error-for"));
  });
  errorEl.classList.add("hidden");
  errorEl.textContent = "";
}

function validateCurrentStep() {
  const problems = problemsForStep(step, values());
  const ids = new Set(problems.map((p) => p.id));
  for (const field of document.querySelectorAll("[data-error-for]")) {
    const id = field.getAttribute("data-error-for");
    if (!ids.has(id)) clearField(id);
  }
  if (!problems.length) {
    errorEl.classList.add("hidden");
    return true;
  }
  for (const problem of problems) showFieldError(problem.id, problem.message);
  errorEl.textContent =
    problems.length === 1
      ? problems[0].message
      : "Fill out the highlighted fields to continue.";
  errorEl.classList.remove("hidden");
  const first = document.getElementById(problems[0].id);
  first?.focus();
  errorEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return false;
}

function optionLabel(group, value) {
  return OPTION_LABELS[group]?.[value] || value;
}

function showStep() {
  panes.forEach((p) => {
    const on = Number(p.dataset.pane) === step;
    p.classList.toggle("hidden", !on);
    p.querySelectorAll("input, textarea, select").forEach((el) => {
      el.disabled = !on;
    });
  });
  stepEls.forEach((s) => {
    const n = Number(s.dataset.step);
    s.classList.toggle("on", n === step);
    s.classList.toggle("done", n < step);
  });
  back.hidden = step === 0;
  next.textContent = step === 3 ? "Create trade" : "Continue";
  next.disabled = false;
  if (step === 3) {
    const amount = Number(document.getElementById("amount").value || 0);
    const currency = document.getElementById("currency").value;
    const role = document.getElementById("role").value;
    document.getElementById("review").innerHTML = `
      <p><strong>${escapeHtml(document.getElementById("title").value)}</strong></p>
      <p class="hint">${escapeHtml(document.getElementById("description").value)}</p>
      <p style="margin-top:10px">${money(Math.round(amount * 100), currency)} · You are the <strong>${escapeHtml(optionLabel("role", role))}</strong></p>
      <p class="hint">Category: ${escapeHtml(optionLabel("category", document.getElementById("category").value))} · Delivery: ${escapeHtml(optionLabel("delivery", document.getElementById("delivery").value))}</p>
      <p class="hint" style="margin-top:8px">${escapeHtml(document.getElementById("terms").value)}</p>
    `;
  }
}

form.addEventListener("input", (event) => {
  const id = event.target?.id;
  if (id) clearField(id);
});
form.addEventListener("change", (event) => {
  const id = event.target?.id;
  if (id) clearField(id);
});

back.addEventListener("click", () => {
  clearStepErrors();
  step = Math.max(0, step - 1);
  showStep();
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  next.click();
});

next.addEventListener("click", async () => {
  if (step < 3) {
    if (!validateCurrentStep()) return;
    clearStepErrors();
    step += 1;
    showStep();
    return;
  }

  if (!validateCurrentStep()) return;
  try {
    policyGate.assertAccepted();
  } catch {
    return;
  }

  const displayName = document.getElementById("display-name").value.trim();
  next.disabled = true;
  try {
    const amount = Number(document.getElementById("amount").value || 0);
    const body = {
      title: document.getElementById("title").value.trim(),
      description: document.getElementById("description").value.trim(),
      amount_cents: Math.round(amount * 100),
      currency: document.getElementById("currency").value,
      category: document.getElementById("category").value,
      delivery_method: document.getElementById("delivery").value,
      creator_role: document.getElementById("role").value,
      terms: { summary: document.getElementById("terms").value.trim() },
      display_name: displayName,
      acceptedRequired: true,
      acceptedOptionalDevice: policyGate.optionalDeviceAccepted(),
      acceptedPolicies: true,
    };
    const result = await api("/api/trades", {
      method: "POST",
      body: JSON.stringify(body),
    });
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

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

showStep();
