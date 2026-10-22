import { api, ensureGuest } from "./api-client.js";
import { money, statusLabel } from "./format.js";

const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");

try {
  await ensureGuest();
  const { trades } = await api("/api/trades");
  statusEl.classList.add("hidden");
  const items = trades || [];
  if (!items.length) {
    emptyEl.classList.remove("hidden");
  } else {
    listEl.classList.remove("hidden");
    listEl.innerHTML = items
      .map(({ role, transaction: tx }) => {
        if (!tx) return "";
        const demo = tx.is_demo
          ? '<span class="tag demo">Demo</span>'
          : "";
        return `<a class="row" href="/room.html?id=${tx.id}">
          <span class="mark">${(role || "?").slice(0, 1).toUpperCase()}</span>
          <div style="flex:1;min-width:0">
            <strong>${escapeHtml(tx.title)}</strong>
            <span class="sub">${escapeHtml(tx.reference_code)} · ${statusLabel(tx.status)} · ${money(tx.amount_cents, tx.currency)} · as ${escapeHtml(role)}</span>
          </div>
          ${demo}
        </a>`;
      })
      .join("");
  }
} catch (err) {
  statusEl.textContent = err.message || "Failed to load";
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
