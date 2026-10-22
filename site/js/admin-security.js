import { api, ensureGuest } from "./api-client.js";

const gate = document.getElementById("admin-gate");
const app = document.getElementById("admin-app");
let currentPublicId = null;

try {
  await ensureGuest();
  const overview = await api("/api/admin/security/overview");
  gate.classList.add("hidden");
  app.classList.remove("hidden");
  renderOverview(overview);
  const events = await api("/api/admin/security/events");
  renderEvents(events.events || []);
} catch (err) {
  gate.textContent =
    err.status === 403 || /forbidden/i.test(err.message || "")
      ? "Access denied. This dashboard requires an authorized security administrator (ts_profiles.is_admin)."
      : err.message || "Could not load security dashboard";
}

function renderOverview(data) {
  const m = data.metrics || {};
  document.getElementById("metrics").innerHTML = [
    ["Incidents awaiting review", m.incidentsAwaitingReview],
    ["High-risk events (7d)", m.highRiskEvents],
    ["Failed invites (7d)", m.failedInvitationAttempts],
    ["Unauthorized access (7d)", m.unauthorizedAccessAttempts],
  ]
    .map(
      ([label, val]) => `
    <div class="progress-box">
      <div class="progress-meta"><span>${escapeHtml(label)}</span><span>${Number(val) || 0}</span></div>
      <p class="progress-hint">No raw IP or fingerprints in summary cards</p>
    </div>`,
    )
    .join("");

  document.getElementById("reports").innerHTML =
    (data.recentReports || [])
      .map(
        (r) => `<div class="bubble">
        <div class="who">${escapeHtml(r.public_id)} · ${escapeHtml(r.status)} · ${escapeHtml(r.triage)}</div>
        <strong>${escapeHtml(r.category)}</strong> — ${escapeHtml(r.summary)}
        <div class="hint">${new Date(r.created_at).toLocaleString()}</div>
        <button type="button" class="ghost btn-sm" data-open="${escapeHtml(r.public_id)}">Investigate</button>
      </div>`,
      )
      .join("") || `<p class="hint">No reports yet.</p>`;

  document.querySelectorAll("[data-open]").forEach((btn) => {
    btn.onclick = () => {
      document.getElementById("inc-id").value = btn.dataset.open;
      loadIncident();
    };
  });
}

function renderEvents(events) {
  document.getElementById("events").innerHTML =
    events
      .slice(0, 40)
      .map(
        (e) => `<div class="bubble">
        <div class="who">${escapeHtml(e.event_type)} · risk ${e.risk_score || 0} · ${escapeHtml(e.ip_masked || "—")}</div>
        ${new Date(e.created_at).toLocaleString()}
      </div>`,
      )
      .join("") || `<p class="hint">No events.</p>`;
}

async function loadIncident() {
  const publicId = document.getElementById("inc-id").value.trim();
  if (!publicId) return;
  currentPublicId = publicId;
  const reveal = document.getElementById("reveal-ip").checked ? "1" : "0";
  const data = await api(
    `/api/admin/security/incidents/${encodeURIComponent(publicId)}?reveal_ip=${reveal}`,
  );
  const inc = data.incident;
  document.getElementById("incident-view").classList.remove("hidden");
  document.getElementById("inc-update").classList.remove("hidden");
  document.getElementById("inc-status").value = inc.status;
  document.getElementById("inc-triage").value = inc.triage;
  document.getElementById("inc-resolution").value = inc.resolution || "";
  document.getElementById("incident-view").innerHTML = `
    <p><strong>${escapeHtml(inc.public_id)}</strong> · ${escapeHtml(inc.category)} · trade ${escapeHtml(inc.transaction_id || "—")}</p>
    <p>${escapeHtml(inc.summary)}</p>
    <p class="hint">${escapeHtml(inc.details || "")}</p>
    <p class="hint">Reporter ref: ${escapeHtml(inc.reporter_ref || "—")}</p>
    <h3 style="margin-top:12px;font-size:15px">Timeline</h3>
    ${(data.timeline || [])
      .map(
        (e) => `<div class="bubble"><div class="who">${escapeHtml(e.event_type)} · ${escapeHtml(e.ip_masked || "")}${e.ip_hash ? ` · hash ${escapeHtml(String(e.ip_hash).slice(0, 12))}…` : ""}</div>${new Date(e.created_at).toLocaleString()}</div>`,
      )
      .join("") || "<p class='hint'>No linked events.</p>"}
    <h3 style="margin-top:12px;font-size:15px">Notes</h3>
    ${(data.notes || [])
      .map((n) => `<div class="bubble">${escapeHtml(n.body)}<div class="hint">${new Date(n.created_at).toLocaleString()}</div></div>`)
      .join("") || "<p class='hint'>No notes.</p>"}
  `;
}

document.getElementById("load-inc").onclick = () =>
  loadIncident().catch((err) => alert(err.message));

document.getElementById("inc-update").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentPublicId) return;
  const msg = document.getElementById("inc-msg");
  try {
    const note = document.getElementById("inc-note").value.trim();
    if (note) {
      await api(`/api/admin/security/incidents/${encodeURIComponent(currentPublicId)}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: note, is_internal: true }),
      });
    }
    await api(`/api/admin/security/incidents/${encodeURIComponent(currentPublicId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: document.getElementById("inc-status").value,
        triage: document.getElementById("inc-triage").value,
        resolution: document.getElementById("inc-resolution").value,
        decision_reason: document.getElementById("inc-resolution").value,
      }),
    });
    msg.textContent = "Saved. Decision and access are audited.";
    msg.classList.remove("hidden");
    document.getElementById("inc-note").value = "";
    await loadIncident();
  } catch (err) {
    msg.textContent = err.message || "Update failed";
    msg.classList.remove("hidden");
  }
});

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
