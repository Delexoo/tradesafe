/**
 * Trade Confidence — privacy-safe participant trust signals.
 * Server-side only. Never return raw device, IP, fingerprint, or email data.
 */

export const CONFIDENCE_DISCLAIMER =
  "These signals provide context, not a guarantee of a safe trade.";

const FORBIDDEN_RESPONSE_KEYS = [
  "ip",
  "ip_hash",
  "ip_masked",
  "fingerprint",
  "device_hash",
  "device_ref",
  "token_hash",
  "session_ref",
  "user_agent",
  "email",
  "user_id",
  "profile_id",
  "auth_id",
  "risk_score",
  "risk_reasons",
];

export function confidenceError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/**
 * Viewer must be a registered, email-verified account.
 * Guests are never eligible.
 */
export function assertConfidenceViewer(viewer) {
  if (!viewer?.id) {
    throw confidenceError(401, "UNAUTHORIZED", "Unauthorized");
  }
  if (viewer.is_guest) {
    throw confidenceError(
      403,
      "CONFIDENCE_GUESTS_EXCLUDED",
      "Trade Confidence is available to registered accounts only.",
    );
  }
  if (!viewer.email_verified) {
    throw confidenceError(
      403,
      "CONFIDENCE_EMAIL_UNVERIFIED",
      "Verify your email to view Trade Confidence.",
    );
  }
  return true;
}

/** Month + year only — never a precise timestamp in the UI. */
export function formatAccountCreatedLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

/** Only finalized, non-demo trades count. */
export function isCompletedTradeForConfidence(tx) {
  if (!tx) return false;
  if (tx.is_demo === true) return false;
  if (tx.status !== "completed") return false;
  return true;
}

/**
 * Build the compact signal list from trusted server fields.
 * Omits unavailable signals rather than inventing them.
 */
export function buildConfidenceSignals({
  isGuest,
  emailVerified,
  createdAt,
  completedCount,
}) {
  const signals = [];

  if (isGuest) {
    signals.push({
      key: "guest_participant",
      label: "Participating as a guest",
    });
    return signals;
  }

  if (emailVerified === true) {
    signals.push({
      key: "email_verified",
      label: "Email verified",
    });
  }

  const created = formatAccountCreatedLabel(createdAt);
  if (created) {
    signals.push({
      key: "account_created",
      label: "Account created",
      value: created,
    });
  }

  const n = Number(completedCount) || 0;
  if (n >= 1) {
    signals.push({
      key: "completed_trades",
      label: "Completed trades",
      value: String(n),
    });
  }

  return signals;
}

/** Walk a JSON-like value and fail if forbidden keys appear. */
export function assertNoSensitiveFields(value, path = "$") {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSensitiveFields(v, `${path}[${i}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [k, v] of Object.entries(value)) {
    const lower = k.toLowerCase();
    if (FORBIDDEN_RESPONSE_KEYS.includes(lower)) {
      throw new Error(`Forbidden field in Trade Confidence response: ${path}.${k}`);
    }
    assertNoSensitiveFields(v, `${path}.${k}`);
  }
}

/**
 * Narrowly scoped Trade Confidence payload for one trade.
 * Authorization is enforced here — do not rely on UI hiding.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {{ id: string, is_guest?: boolean, email_verified?: boolean }} viewer
 * @param {string} tradeId
 */
export async function getTradeConfidence(admin, viewer, tradeId) {
  assertConfidenceViewer(viewer);

  if (!tradeId || typeof tradeId !== "string") {
    throw confidenceError(400, "INVALID_TRADE", "Invalid trade id");
  }

  const { data: tx, error: txErr } = await admin
    .from("ts_transactions")
    .select("id, creator_id, status, is_demo")
    .eq("id", tradeId)
    .maybeSingle();
  if (txErr) throw new Error(txErr.message);
  if (!tx) throw confidenceError(404, "NOT_FOUND", "Transaction not found");

  const { data: myPart } = await admin
    .from("ts_participants")
    .select("id, role, status, user_id")
    .eq("transaction_id", tradeId)
    .eq("user_id", viewer.id)
    .eq("status", "joined")
    .maybeSingle();

  if (!myPart && tx.creator_id !== viewer.id) {
    throw confidenceError(
      403,
      "TRADE_ACCESS_DENIED",
      "You are not a participant in this trade.",
    );
  }

  // Creator who has not joined as buyer/seller still must be a joined participant slot
  if (!myPart) {
    throw confidenceError(
      403,
      "TRADE_ACCESS_DENIED",
      "You are not a joined participant in this trade.",
    );
  }

  const { data: participants, error: pErr } = await admin
    .from("ts_participants")
    .select("id, role, status, user_id, display_name")
    .eq("transaction_id", tradeId)
    .in("role", ["buyer", "seller"]);
  if (pErr) throw new Error(pErr.message);

  const counterpart = (participants || []).find(
    (p) => p.role !== myPart.role && p.status === "joined" && p.user_id,
  );

  if (!counterpart) {
    const pending = {
      available: false,
      reason: "counterpart_pending",
      disclaimer: CONFIDENCE_DISCLAIMER,
    };
    assertNoSensitiveFields(pending);
    return pending;
  }

  if (counterpart.user_id === viewer.id) {
    throw confidenceError(
      403,
      "CONFIDENCE_SELF",
      "Trade Confidence is only available for the other participant.",
    );
  }

  const { data: profile } = await admin
    .from("ts_profiles")
    .select("id, is_guest, created_at")
    .eq("id", counterpart.user_id)
    .maybeSingle();

  const isGuest = !!profile?.is_guest;
  let emailVerified = false;
  let createdAt = profile?.created_at || null;

  if (!isGuest && counterpart.user_id) {
    try {
      const { data: authData, error: authErr } =
        await admin.auth.admin.getUserById(counterpart.user_id);
      if (!authErr && authData?.user) {
        emailVerified = !!(
          authData.user.email_confirmed_at || authData.user.confirmed_at
        );
        if (!createdAt && authData.user.created_at) {
          createdAt = authData.user.created_at;
        }
      }
    } catch {
      // Auth lookup failure → omit email-verified rather than inventing it
      emailVerified = false;
    }
  }

  let completedCount = 0;
  if (!isGuest && counterpart.user_id) {
    completedCount = await countCompletedNonDemoTrades(
      admin,
      counterpart.user_id,
    );
  }

  const signals = buildConfidenceSignals({
    isGuest,
    emailVerified,
    createdAt,
    completedCount,
  });

  const payload = {
    available: true,
    counterpartRole: counterpart.role,
    signals,
    disclaimer: CONFIDENCE_DISCLAIMER,
  };
  assertNoSensitiveFields(payload);
  return payload;
}

export async function countCompletedNonDemoTrades(admin, userId) {
  const { data: parts, error } = await admin
    .from("ts_participants")
    .select("transaction_id, ts_transactions(status, is_demo)")
    .eq("user_id", userId)
    .eq("status", "joined");
  if (error) throw new Error(error.message);

  const seen = new Set();
  let count = 0;
  for (const row of parts || []) {
    const tx = row.ts_transactions;
    if (!tx || !isCompletedTradeForConfidence(tx)) continue;
    const tid = row.transaction_id;
    if (!tid || seen.has(tid)) continue;
    seen.add(tid);
    count += 1;
  }
  return count;
}
