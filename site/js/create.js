import { requireUser, api } from "./supabase.js";
import { renderAppNav } from "./nav.js";
import { money } from "./format.js";

renderAppNav("dashboard");
await requireUser();

let step = 0;
const panes = [...document.querySelectorAll("[data-pane]")];
const stepEls = [...document.querySelectorAll("#steps span")];
const back = document.getElementById("back");
const next = document.getElementById("next");
const form = document.getElementById("create-form");
const errorEl = document.getElementById("error");

function showStep() {
  panes.forEach((p) => p.classList.toggle("hidden", Number(p.dataset.pane) !== step));
  stepEls.forEach((s) => s.classList.toggle("on", Number(s.dataset.step) === step));
  back.hidden = step === 0;
  next.textContent = step === 3 ? "Create trade" : "Continue";
  if (step === 3) {
    const amount = Number(document.getElementById("amount").value || 0);
    const currency = document.getElementById("currency").value;
    document.getElementById("review").innerHTML = `
      <p><strong>${escapeHtml(document.getElementById("title").value)}</strong></p>
      <p class="hint">${escapeHtml(document.getElementById("description").value || "No description")}</p>
      <p style="margin-top:10px">${money(Math.round(amount * 100), currency)} · You are the <strong>${document.getElementById("role").value}</strong></p>
      <p class="hint">Category: ${document.getElementById("category").value} · Delivery: ${document.getElementById("delivery").value}</p>
      <p class="hint" style="margin-top:8px">${escapeHtml(document.getElementById("terms").value || "Default dispute and cancellation terms apply.")}</p>
    `;
  }
}

back.addEventListener("click", () => {
  step = Math.max(0, step - 1);
  showStep();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.classList.add("hidden");
  if (step < 3) {
    if (step === 0 && !form.reportValidity()) return;
    if (step === 2 && !document.getElementById("ack").checked) {
      errorEl.textContent = "Please acknowledge the terms.";
      errorEl.classList.remove("hidden");
      return;
    }
    step += 1;
    showStep();
    return;
  }
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
    };
    const result = await api("/api/trades", {
      method: "POST",
      body: JSON.stringify(body),
    });
    form.classList.add("hidden");
    document.getElementById("created").classList.remove("hidden");
    const url = `${location.origin}${result.inviteUrl}`;
    document.getElementById("invite-url").value = url;
    document.getElementById("open-room").href = `/room.html?id=${result.transaction.id}`;
    document.getElementById("copy-invite").onclick = async () => {
      await navigator.clipboard.writeText(url);
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
    .replaceAll(">", "&gt;");
}

showStep();
