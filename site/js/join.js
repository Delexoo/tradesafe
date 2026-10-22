import { api } from "./api-client.js";
import { renderAppNav } from "./nav.js";
import { money, statusLabel } from "./format.js";
import { policyCheckboxHtml, wirePolicyGate } from "./policy-checkbox.js";

renderAppNav("dashboard");

const params = new URLSearchParams(location.search);
const token = params.get("token") || location.pathname.split("/").pop();
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const summaryEl = document.getElementById("summary");
const form = document.getElementById("join-form");
const joinBtn = document.getElementById("join-btn");

document.getElementById("policy-box").innerHTML = policyCheckboxHtml("policy-accept");
const policyGate = wirePolicyGate(
  document.getElementById("policy-accept"),
  joinBtn,
  errorEl,
);

try {
  const preview = await api(
    `/api/invitations/preview?token=${encodeURIComponent(token)}`,
  );
  const tx = preview.transaction;
  statusEl.classList.add("hidden");
  summaryEl.classList.remove("hidden");
  summaryEl.innerHTML = `
    <p><strong>${escapeHtml(tx.title)}</strong></p>
    <p class="hint">${escapeHtml(tx.reference_code)} · ${statusLabel(tx.status)}${tx.is_demo ? " · DEMO" : ""}</p>
    <p style="margin-top:8px">${money(tx.amount_cents, tx.currency)}</p>
    <p class="hint">You’ll join as <strong>${escapeHtml(preview.role)}</strong>. Private chat and evidence stay locked until you join.</p>
  `;
  form.classList.remove("hidden");
} catch (err) {
  statusEl.classList.add("hidden");
  form.classList.remove("hidden");
  document.getElementById("policy-box").classList.add("hidden");
  joinBtn.classList.add("hidden");
  errorEl.textContent = err.message || "Invalid invitation";
  errorEl.classList.remove("hidden");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.classList.add("hidden");
  try {
    policyGate.assertAccepted();
  } catch {
    return;
  }
  const displayName = document.getElementById("display-name").value.trim();
  if (!displayName) {
    errorEl.textContent = "Enter a display name.";
    errorEl.classList.remove("hidden");
    return;
  }
  joinBtn.disabled = true;
  statusEl.textContent = "Joining…";
  statusEl.classList.remove("hidden");
  try {
    const result = await api("/api/invitations/join", {
      method: "POST",
      body: JSON.stringify({
        token,
        display_name: displayName,
        acceptedPolicies: true,
      }),
    });
    location.href = `/room.html?id=${result.transactionId}`;
  } catch (err) {
    statusEl.classList.add("hidden");
    errorEl.textContent = err.message || "Could not join";
    errorEl.classList.remove("hidden");
    joinBtn.disabled = !document.getElementById("policy-accept").checked;
  }
});

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
