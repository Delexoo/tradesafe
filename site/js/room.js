import { api, ensureGuest } from "./api-client.js";
import { platformFeeCents, sellerNetCents } from "./fees.js";
import { money, statusLabel } from "./format.js";
import { enhanceSelect } from "./listbox.js";
import { nextStep } from "./room-actions.js";

const ANON_AVATAR = `<span class="avatar anon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="9" r="3.2" fill="currentColor"/><path d="M5.2 19.2c1.1-3 3.6-4.5 6.8-4.5s5.7 1.5 6.8 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>`;

const params = new URLSearchParams(location.search);
const id = params.get("id");
const boot = document.getElementById("boot");
const roomEl = document.getElementById("room");
const errEl = document.getElementById("room-error");
let myActorId = null;
/** @type {null | object} cached confidence payload for this room load */
let confidenceCache = null;
let confidenceFetchInFlight = null;
let confidenceParticipantsKey = "";

if (!id) {
  boot.classList.add("hidden");
  errEl.classList.remove("hidden");
} else {
  try {
    await ensureGuest();
    if (new URLSearchParams(location.search).get("payout") === "return") {
      await api("/api/payouts").catch(() => {});
    }
    const profile = await api("/api/profile");
    myActorId = profile.profile?.id;
    await loadRoom(myActorId);
    // Poll for updates (guest-friendly; no Supabase auth required)
    setInterval(() => loadRoom(myActorId).catch(() => {}), 8000);
  } catch (err) {
    boot.classList.add("hidden");
    document.getElementById("room-error-text").textContent =
      err.message || "Could not load room";
    errEl.classList.remove("hidden");
  }
}

async function loadRoom(userId) {
  const data = await api(`/api/trades/${id}`);
  boot.classList.add("hidden");
  roomEl.classList.remove("hidden");
  render(data, userId || myActorId);
}

function meAccepted(data, userId) {
  return (data.participants || []).some(
    (p) => p.user_id === userId && p.terms_accepted_at,
  );
}

function render(data, userId) {
  const tx = data.transaction;
  const myRole = data.myRole;

  document.getElementById("title").textContent = tx.title;
  const fee = platformFeeCents(tx.amount_cents);
  const net = sellerNetCents(tx.amount_cents);
  document.getElementById("amount-line").textContent =
    `${money(tx.amount_cents, tx.currency)} · seller net ~${money(net, tx.currency)}`;
  document.getElementById("ref").textContent = `Ref ${tx.reference_code}`;
  document.getElementById("status-tag").textContent = statusLabel(tx.status);
  const terms = tx.terms && typeof tx.terms === "object" ? tx.terms : {};
  const termsBits = [];
  if (terms.preview_url) {
    termsBits.push(
      `<p class="hint">Preview: <a href="${escapeHtml(terms.preview_url)}" target="_blank" rel="noopener">${escapeHtml(terms.preview_url)}</a></p>`,
    );
  }
  if (terms.domain_name) {
    termsBits.push(`<p class="hint">Domain: <strong>${escapeHtml(terms.domain_name)}</strong></p>`);
  }
  if (terms.service_scope) {
    termsBits.push(`<p class="hint">Done means: ${escapeHtml(terms.service_scope)}</p>`);
  }
  let termsEl = document.getElementById("terms-bits");
  if (!termsEl) {
    termsEl = document.createElement("div");
    termsEl.id = "terms-bits";
    document.getElementById("amount-line")?.after(termsEl);
  }
  termsEl.innerHTML = termsBits.join("");

  const live = !["completed", "cancelled", "expired", "refunded"].includes(
    tx.status,
  );
  const liveDot = document.getElementById("live-dot");
  liveDot.classList.toggle("live", live);
  liveDot.querySelector("span").textContent = live ? "Live" : "Closed";

  document.getElementById("participants").innerHTML = (data.participants || [])
    .map((p) => {
      const pending = p.status !== "joined";
      const name = pending
        ? "Waiting"
        : p.display_name ||
          p.ts_profiles?.display_name ||
          p.role ||
          "Guest";
      return `<div class="person">
        ${ANON_AVATAR}
        <div>
          <strong>${escapeHtml(name)}</strong>
          <div class="hint">${escapeHtml(p.role)}${pending ? " · pending" : ""}</div>
        </div>
      </div>`;
    })
    .join("");

  // Trade Confidence loads separately — never blocks the room and never embeds
  // signals in the public room payload.
  const partKey = (data.participants || [])
    .filter((p) => p.status === "joined" && p.user_id)
    .map((p) => `${p.role}:${p.user_id}`)
    .sort()
    .join("|");
  if (partKey !== confidenceParticipantsKey) {
    confidenceParticipantsKey = partKey;
    confidenceCache = null;
  }
  loadTradeConfidence();

  document.getElementById("chat").innerHTML = (data.messages || [])
    .map((m) => {
      const name = m.ts_profiles?.display_name || "Participant";
      return `<div class="bubble"><div class="who">${escapeHtml(name)}</div>${escapeHtml(m.body)}</div>`;
    })
    .join("") || `<p class="hint">No messages yet.</p>`;

  renderActions(tx, myRole, data, userId);
  document.getElementById("share").onclick = async () => {
    try {
      const inv = await api("/api/invitations/create", {
        method: "POST",
        body: JSON.stringify({
          transactionId: tx.id,
          role: myRole === "buyer" ? "seller" : "buyer",
        }),
      });
      const url = `${location.origin}${inv.url}`;
      await navigator.clipboard.writeText(url);
      alert("Invite link copied.");
    } catch (err) {
      alert(err.message || "Could not create invite");
    }
  };
}

function renderActions(tx, role, data, userId) {
  const box = document.getElementById("actions");
  const paidWaiting = new URLSearchParams(location.search).get("paid") === "1";
  const terms = tx.terms && typeof tx.terms === "object" ? tx.terms : {};
  const fee = platformFeeCents(tx.amount_cents);
  const net = sellerNetCents(tx.amount_cents);
  const step = nextStep({
    status: tx.status,
    role,
    accepted: meAccepted(data, userId),
    paidWaiting,
    payoutReady: data.payoutReady,
    category: tx.category,
    terms,
    amountCents: tx.amount_cents,
    currency: tx.currency,
    feeCents: fee,
    netCents: net,
  });
  let track = "";
  if (step.track) {
    const mode = step.trackMode || "other";
    if (mode === "ship_carrier") {
      track = `
        <label class="field-label" for="track-mode">Delivery proof</label>
        <select class="field" id="track-mode">
          <option value="carrier" selected>Official carrier tracking</option>
          <option value="other">Other delivery (no tracking)</option>
        </select>
        <label class="field-label" for="track-input" id="track-input-label">Tracking number</label>
        <input class="field" id="track-input" maxlength="200" placeholder="${escapeHtml(step.trackPlaceholder || "")}">`;
    } else {
      track = `
        <label class="field-label" for="track-input">${escapeHtml(
          mode === "digital"
            ? "Delivery link or note"
            : mode === "domain"
              ? "Transfer evidence"
              : mode === "service"
                ? "Completion note"
                : "Note",
        )}</label>
        <input class="field" id="track-input" maxlength="500" placeholder="${escapeHtml(step.trackPlaceholder || "")}">
        <input type="hidden" id="track-mode" value="${escapeHtml(mode === "ship_other" ? "other" : mode)}">`;
    }
  }
  const button = step.action
    ? btn(step.action.label, step.action.act, "btn act-btn")
    : "";
  box.innerHTML = `
    <p class="turn-line">${escapeHtml(step.headline)}</p>
    <p class="hint">${escapeHtml(step.detail)}</p>
    ${track}
    ${button}
    <p id="action-error" class="field-error hidden" role="alert"></p>`;

  const modeSelect = box.querySelector("#track-mode");
  const trackInput = box.querySelector("#track-input");
  const trackLabel = box.querySelector("#track-input-label");
  if (modeSelect && modeSelect.tagName === "SELECT") {
    enhanceSelect(modeSelect);
    modeSelect.addEventListener("change", () => {
      if (!trackInput) return;
      const other = modeSelect.value === "other";
      if (trackLabel) trackLabel.textContent = other ? "How you handed it over" : "Tracking number";
      trackInput.placeholder = other
        ? "Describe delivery without a carrier tracking number"
        : "Tracking number";
    });
  }

  box.querySelectorAll("[data-act]").forEach((el) => {
    el.onclick = () => runAction(el.dataset.act, tx);
  });
}

function showActionError(message) {
  const el = document.getElementById("action-error");
  if (!el) {
    alert(message);
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}

function btn(label, act, cls = "btn") {
  return `<button type="button" class="${cls}" data-act="${act}">${label}</button>`;
}

async function runAction(act, tx) {
  try {
    if (act === "accept") {
      await api(`/api/trades/${tx.id}/accept`, { method: "POST", body: "{}" });
    } else if (act === "payout") {
      const result = await api("/api/payouts/link", {
        method: "POST",
        body: JSON.stringify({
          returnPath: `${location.pathname}${location.search}`,
        }),
      });
      if (!result.url) throw new Error("Could not open the payout account. Try again.");
      location.href = result.url;
      return;
    } else if (act === "pay") {
      const result = await api(`/api/trades/${tx.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: "initiate_payment", payload: {} }),
      });
      if (result.url) {
        location.href = result.url;
        return;
      }
      throw new Error("Card payment did not open. Try again.");
    } else if (act === "track") {
      const note = document.getElementById("track-input")?.value.trim() || "";
      const mode = document.getElementById("track-mode")?.value || "other";
      if (!note) {
        showActionError(
          mode === "carrier"
            ? "Add a tracking number first."
            : "Add a short delivery note first.",
        );
        return;
      }
      const payload =
        mode === "carrier"
          ? { tracking_number: note, notes: note, ship_mode: "carrier" }
          : { tracking_number: null, notes: note, ship_mode: "other" };
      await api(`/api/trades/${tx.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action: "submit_tracking",
          payload,
        }),
      });
    } else if (act === "confirm") {
      await api(`/api/trades/${tx.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: "confirm_delivery", payload: {} }),
      });
    }
    await loadRoom(myActorId);
  } catch (err) {
    showActionError(err.message || "That did not work. Try again.");
  }
}

document.getElementById("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const body = input.value.trim();
  if (!body) return;
  try {
    await api(`/api/trades/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    input.value = "";
    await loadRoom(myActorId);
  } catch (err) {
    alert(err.message || "Could not send");
  }
});

document.getElementById("report-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("report-msg");
  msg.classList.add("hidden");
  try {
    const result = await api(`/api/trades/${id}/report`, {
      method: "POST",
      body: JSON.stringify({
        category: document.getElementById("report-category").value,
        summary: document.getElementById("report-summary").value.trim(),
        details: document.getElementById("report-details").value.trim(),
      }),
    });
    msg.textContent = `Report ${result.public_id} submitted. Status: ${result.status}.`;
    msg.classList.remove("hidden");
    document.getElementById("report-summary").value = "";
    document.getElementById("report-details").value = "";
  } catch (err) {
    msg.textContent = err.message || "Could not submit report";
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

async function loadTradeConfidence() {
  const card = document.getElementById("confidence-card");
  const body = document.getElementById("confidence-body");
  if (!card || !body || !id) return;

  if (confidenceCache) {
    renderConfidence(confidenceCache);
    return;
  }
  if (confidenceFetchInFlight) {
    try {
      renderConfidence(await confidenceFetchInFlight);
    } catch {
      card.classList.add("hidden");
    }
    return;
  }

  confidenceFetchInFlight = api(`/api/trades/${id}/confidence`)
    .then((data) => {
      confidenceCache = data;
      return data;
    })
    .finally(() => {
      confidenceFetchInFlight = null;
    });

  try {
    const data = await confidenceFetchInFlight;
    renderConfidence(data);
  } catch (err) {
    // Guests, unverified accounts, and non-participants: hide quietly.
    // Do not surface confidence errors into the main room.
    card.classList.add("hidden");
    confidenceCache = null;
    if (
      err?.code !== "CONFIDENCE_GUESTS_EXCLUDED" &&
      err?.code !== "CONFIDENCE_EMAIL_UNVERIFIED" &&
      err?.status !== 401 &&
      err?.status !== 403
    ) {
      // Unexpected failures stay silent in the room UI
    }
  }
}

function renderConfidence(data) {
  const card = document.getElementById("confidence-card");
  const body = document.getElementById("confidence-body");
  if (!card || !body) return;

  if (!data?.available) {
    if (data?.reason === "counterpart_pending") {
      card.classList.remove("hidden");
      body.innerHTML = `
        <p class="hint">Signals appear after the other participant joins this trade.</p>
        <p class="confidence-foot">${escapeHtml(data.disclaimer || "")}</p>`;
      return;
    }
    card.classList.add("hidden");
    return;
  }

  const signals = Array.isArray(data.signals) ? data.signals : [];
  if (!signals.length) {
    card.classList.remove("hidden");
    body.innerHTML = `
      <p class="hint">No account signals are available for this participant yet.</p>
      <p class="confidence-foot">${escapeHtml(data.disclaimer || "")}</p>`;
    return;
  }

  const role = data.counterpartRole
    ? `<p class="hint">About the ${escapeHtml(data.counterpartRole)}</p>`
    : "";

  card.classList.remove("hidden");
  body.innerHTML = `
    ${role}
    <ul class="confidence-list" aria-label="Trade Confidence signals">
      ${signals
        .map((s) => {
          const text = s.value
            ? `${escapeHtml(s.label)}: ${escapeHtml(s.value)}`
            : escapeHtml(s.label);
          return `<li>${text}</li>`;
        })
        .join("")}
    </ul>
    <p class="confidence-foot">${escapeHtml(data.disclaimer || "")}</p>`;
}
