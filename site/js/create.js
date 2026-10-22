import { api } from "./api-client.js";
import { problemsForStep } from "./create-form.js";
import { policyCheckboxHtml, wirePolicyGate } from "./policy-checkbox.js";

const form = document.getElementById("create-form");
const next = document.getElementById("next");
const errorEl = document.getElementById("error");
const wizard = document.getElementById("wizard");
const roleInput = document.getElementById("role");

document.getElementById("policy-box").innerHTML = policyCheckboxHtml({ compact: true });
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
  const problems = problemsForStep(0, values());
  for (const node of document.querySelectorAll("[data-error-for]")) {
    const id = node.getAttribute("data-error-for");
    if (!problems.some((p) => p.id === id)) clearField(id);
  }
  if (!problems.length) {
    errorEl.classList.add("hidden");
    return true;
  }
  for (const problem of problems) showFieldError(problem.id, problem.message);
  errorEl.textContent =
    problems.length === 1
      ? problems[0].message
      : "Fill out the highlighted fields.";
  errorEl.classList.remove("hidden");
  document.getElementById(problems[0].id)?.focus();
  return false;
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

next.addEventListener("click", async () => {
  if (!validate()) return;
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
        terms: { summary: document.getElementById("terms").value.trim() },
        display_name: document.getElementById("display-name").value.trim(),
        acceptedRequired: true,
        acceptedOptionalDevice: policyGate.optionalDeviceAccepted(),
        acceptedPolicies: true,
      }),
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
