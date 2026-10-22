import { requireUser, api } from "./supabase.js";
import { renderAppNav } from "./nav.js";
import { money, statusLabel } from "./format.js";

renderAppNav("history");

const terminal = new Set([
  "completed",
  "cancelled",
  "refunded",
  "expired",
  "disputed",
]);

const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");

try {
  await requireUser();
  const { trades } = await api("/api/trades");
  const items = (trades || []).filter((t) =>
    terminal.has(t.transaction?.status),
  );
  statusEl.classList.add("hidden");
  if (!items.length) {
    emptyEl.classList.remove("hidden");
  } else {
    listEl.classList.remove("hidden");
    listEl.innerHTML = items
      .map(({ role, transaction: tx }) => {
        return `<a class="row" href="/room.html?id=${tx.id}">
          <div style="flex:1">
            <strong>${escapeHtml(tx.title)}</strong>
            <span class="sub">${statusLabel(tx.status)} · ${money(tx.amount_cents, tx.currency)} · ${escapeHtml(role)}</span>
          </div>
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
    .replaceAll(">", "&gt;");
}
