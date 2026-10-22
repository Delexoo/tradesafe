import { api, ensureGuest } from "./api-client.js";
import { money, statusLabel } from "./format.js";

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

function turnLine(tx, role, data, userId) {
  const st = tx.status;
  const waiting = "Waiting on the other person.";
  if (st === "completed") return "This trade is complete.";
  if (st === "cancelled" || st === "expired") return "This trade is closed.";
  if (st === "disputed") return "This trade is in dispute.";
  if (st === "refunded") return "This trade was refunded.";
  if (st === "awaiting_acceptance") {
    return meAccepted(data, userId)
      ? "Waiting for the other person to accept."
      : "Accept the trade to continue.";
  }
  if (st === "awaiting_payment" || st === "payment_pending") {
    return role === "buyer" ? "Your turn to pay." : waiting;
  }
  if (["awaiting_fulfillment", "funds_authorized", "in_fulfillment"].includes(st)) {
    return role === "seller" ? "Your turn to send it." : waiting;
  }
  if (st === "awaiting_confirmation") {
    return role === "buyer" ? "Your turn to confirm you received it." : waiting;
  }
  return statusLabel(st);
}

function render(data, userId) {
  const tx = data.transaction;
  const myRole = data.myRole;

  document.getElementById("title").textContent = tx.title;
  document.getElementById("amount-line").textContent = money(tx.amount_cents, tx.currency);
  document.getElementById("turn-line").textContent = turnLine(tx, myRole, data, userId);
  document.getElementById("ref").textContent = `Ref ${tx.reference_code}`;
  document.getElementById("status-tag").textContent = statusLabel(tx.status);
  document.getElementById("demo-tag").classList.toggle("hidden", !tx.is_demo);

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
  const buttons = [];
  const st = tx.status;

  if (
    (role === "buyer" || role === "seller") &&
    st === "awaiting_acceptance" &&
    !meAccepted(data, userId)
  ) {
    buttons.push(btn("Accept", "accept", "btn act-btn"));
  }
  if (role === "buyer" && (st === "awaiting_payment" || st === "payment_pending")) {
    buttons.push(btn(tx.is_demo ? "Pay (demo)" : "Pay", "pay", "btn act-btn"));
  }
  if (role === "seller" && ["awaiting_fulfillment", "funds_authorized", "in_fulfillment"].includes(st)) {
    buttons.push(btn("I'm preparing it", "prepare", "btn act-btn"));
    buttons.push(btn("I sent it", "track", "btn act-btn"));
  }
  if (role === "buyer" && st === "awaiting_confirmation") {
    buttons.push(btn("I received it", "confirm", "btn act-btn"));
  }
  if (!["completed", "cancelled"].includes(st)) {
    buttons.push(btn("Open a dispute", "dispute", "ghost act-quiet"));
  }

  box.innerHTML =
    (tx.is_demo ? `<p class="hint demo-note">Demo trade. These buttons update a simulation, not real money.</p>` : "") +
    (buttons.join("") || `<p class="hint">Nothing for you to do right now.</p>`);

  box.querySelectorAll("[data-act]").forEach((el) => {
    el.onclick = () => runAction(el.dataset.act, tx);
  });
}

function btn(label, act, cls = "btn") {
  return `<button type="button" class="${cls}" data-act="${act}">${label}</button>`;
}

async function runAction(act, tx) {
  try {
    if (act === "accept") {
      await api(`/api/trades/${tx.id}/accept`, { method: "POST", body: "{}" });
    } else if (act === "pay") {
      await api(`/api/trades/${tx.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: "initiate_payment", payload: {} }),
      });
      if (tx.is_demo) {
        await api(`/api/trades/${tx.id}/actions`, {
          method: "POST",
          body: JSON.stringify({
            action: "demo_authorize_payment",
            payload: {},
          }),
        });
      }
    } else if (act === "prepare") {
      await api(`/api/trades/${tx.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: "mark_preparing", payload: {} }),
      });
    } else if (act === "track") {
      await api(`/api/trades/${tx.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action: "submit_tracking",
          payload: { tracking_number: "DEMO-TRACK", notes: "Transfer update" },
        }),
      });
    } else if (act === "confirm") {
      await api(`/api/trades/${tx.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: "confirm_delivery", payload: {} }),
      });
    } else if (act === "dispute") {
      await api(`/api/trades/${tx.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action: "open_dispute",
          payload: { reason: "Opened from room", details: "" },
        }),
      });
    }
    await loadRoom(myActorId);
  } catch (err) {
    alert(err.message || "Action failed");
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
