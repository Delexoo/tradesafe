import { createHash, randomBytes } from "node:crypto";

export const CONSENT_BUNDLE_VERSION = "2026-10-22-s";
export const REQUIRED_POLICY_KEYS = [
  "tos",
  "privacy",
  "transaction_dispute",
  "security_fraud",
  "device_notice",
];
export const DEVICE_COOKIE = "ts_device";
export const IP_HASH_PEPPER =
  process.env.SECURITY_IP_PEPPER || "tradesafe-dev-pepper-change-me";

export function hashValue(raw) {
  return createHash("sha256").update(String(raw), "utf8").digest("hex");
}

/** Trust only leftmost client IP when behind a known proxy (Vercel). */
export function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) {
    // Vercel / reverse proxy: first hop is client
    return xf.split(",")[0].trim().slice(0, 64);
  }
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.length) return real.trim().slice(0, 64);
  return req.socket?.remoteAddress || null;
}

export function maskIp(ip) {
  if (!ip) return null;
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return parts.slice(0, 3).join(":") + "::xxxx";
  }
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  return "masked";
}

export function hashIp(ip) {
  if (!ip) return null;
  return hashValue(`${IP_HASH_PEPPER}:${ip}`);
}

export function parseUa(ua = "") {
  const s = String(ua);
  let browser_family = "unknown";
  let os_family = "unknown";
  let device_category = "desktop";
  if (/mobile/i.test(s) && !/ipad|tablet/i.test(s)) device_category = "mobile";
  else if (/ipad|tablet/i.test(s)) device_category = "tablet";
  if (/edg\//i.test(s)) browser_family = "Edge";
  else if (/chrome\//i.test(s)) browser_family = "Chrome";
  else if (/firefox\//i.test(s)) browser_family = "Firefox";
  else if (/safari\//i.test(s)) browser_family = "Safari";
  if (/windows/i.test(s)) os_family = "Windows";
  else if (/android/i.test(s)) os_family = "Android";
  else if (/iphone|ipad|ios/i.test(s)) os_family = "iOS";
  else if (/mac os/i.test(s)) os_family = "macOS";
  else if (/linux/i.test(s)) os_family = "Linux";
  return { browser_family, os_family, device_category };
}

export function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function deviceCookieHeader(raw) {
  const maxAge = 365 * 86400;
  const secure =
    process.env.VERCEL || process.env.NODE_ENV === "production"
      ? "; Secure"
      : "";
  return `${DEVICE_COOKIE}=${encodeURIComponent(raw)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function logSecurityEvent(admin, evt) {
  const row = {
    event_type: evt.event_type,
    severity: evt.severity || "info",
    actor_id: evt.actor_id || null,
    transaction_id: evt.transaction_id || null,
    session_ref: evt.session_ref || null,
    device_ref: evt.device_ref || null,
    ip_hash: evt.ip_hash || null,
    ip_masked: evt.ip_masked || null,
    user_agent: evt.user_agent ? String(evt.user_agent).slice(0, 400) : null,
    correlation_id: evt.correlation_id || null,
    risk_score: evt.risk_score || 0,
    risk_reasons: evt.risk_reasons || [],
    payload: evt.payload || {},
  };
  const { error } = await admin.from("ts_security_events").insert(row);
  if (error) console.error("security_event_failed", error.message);
  return row;
}

export async function hasRequiredConsent(admin, actorId) {
  const { data } = await admin
    .from("ts_security_consents")
    .select("id, consent_bundle_version, required_accepted, optional_device_accepted")
    .eq("actor_id", actorId)
    .eq("consent_bundle_version", CONSENT_BUNDLE_VERSION)
    .eq("required_accepted", true)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function requireSecurityConsent(admin, actorId) {
  const c = await hasRequiredConsent(admin, actorId);
  if (!c) {
    const err = new Error(
      "You must accept the required security and platform policies before continuing.",
    );
    err.status = 403;
    err.code = "CONSENT_REQUIRED";
    throw err;
  }
  return c;
}

/**
 * Record required (+ optional device) consent. Versions come from DB only.
 */
export async function recordSecurityConsent(
  admin,
  actorId,
  { acceptedRequired, acceptedOptionalDevice, userAgent },
) {
  if (acceptedRequired !== true) {
    const err = new Error(
      "You must actively accept the Terms, Privacy, Security, Dispute, and Device Notice policies.",
    );
    err.status = 400;
    throw err;
  }
  const { data: policies, error } = await admin
    .from("ts_policy_versions")
    .select("id, policy_key, version, content_hash")
    .eq("is_active", true)
    .in("policy_key", REQUIRED_POLICY_KEYS);
  if (error) throw new Error(error.message);
  for (const key of REQUIRED_POLICY_KEYS) {
    if (!(policies || []).some((p) => p.policy_key === key)) {
      throw new Error(`Missing active policy: ${key}`);
    }
  }
  const { error: cErr } = await admin.from("ts_security_consents").insert({
    actor_id: actorId,
    consent_bundle_version: CONSENT_BUNDLE_VERSION,
    required_accepted: true,
    optional_device_accepted: acceptedOptionalDevice === true,
    user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
  });
  if (cErr) throw new Error(cErr.message);

  const rows = (policies || []).map((p) => ({
    actor_id: actorId,
    policy_version_id: p.id,
    policy_key: p.policy_key,
    policy_version: p.version,
    content_hash: p.content_hash,
    method: "checkbox",
    user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
  }));
  const { error: aErr } = await admin.from("ts_policy_acceptances").insert(rows);
  if (aErr) throw new Error(aErr.message);
  return {
    consent_bundle_version: CONSENT_BUNDLE_VERSION,
    optional_device_accepted: acceptedOptionalDevice === true,
  };
}

export async function ensureDeviceToken(
  admin,
  req,
  actorId,
  optionalDeviceAccepted,
  pendingCookies,
) {
  if (!optionalDeviceAccepted) return null;
  const cookies = parseCookies(req);
  let raw = cookies[DEVICE_COOKIE];
  const ua = req.headers["user-agent"] || "";
  const meta = parseUa(ua);
  if (raw) {
    const { data } = await admin
      .from("ts_device_tokens")
      .select("id, token_hash, revoked_at")
      .eq("token_hash", hashValue(raw))
      .maybeSingle();
    if (data && !data.revoked_at) {
      await admin
        .from("ts_device_tokens")
        .update({
          last_seen_at: new Date().toISOString(),
          actor_id: actorId,
          ...meta,
          user_agent: String(ua).slice(0, 400),
        })
        .eq("id", data.id);
      return { ref: data.token_hash.slice(0, 16), is_new: false };
    }
  }
  raw = randomBytes(32).toString("base64url");
  const token_hash = hashValue(raw);
  await admin.from("ts_device_tokens").insert({
    token_hash,
    actor_id: actorId,
    ...meta,
    user_agent: String(ua).slice(0, 400),
  });
  pendingCookies.push(deviceCookieHeader(raw));
  return { ref: token_hash.slice(0, 16), is_new: true };
}

export function scoreRisk({ isNewDevice, inviteFailCount = 0 }) {
  const reasons = [];
  let score = 0;
  if (isNewDevice) {
    score += 15;
    reasons.push("new_device_token");
  }
  if (inviteFailCount >= 5) {
    score += 40;
    reasons.push("repeated_invite_failures");
  }
  return { score, reasons };
}

export function incidentPublicId() {
  return `INC-${randomBytes(4).toString("hex").toUpperCase()}`;
}
