import { createHash, randomBytes } from "node:crypto";
import {
  clientIp,
  hashIp,
  maskIp,
  logSecurityEvent,
  ensureDeviceToken,
  scoreRisk,
  hasRequiredConsent,
  recordSecurityConsent,
  requireSecurityConsent,
  CONSENT_BUNDLE_VERSION,
} from "./security.mjs";
import { hashToken } from "./guest-auth.mjs";

const inviteFailBuckets = new Map();

export function correlationId() {
  return randomBytes(8).toString("hex");
}

export function sessionRef(actor) {
  if (!actor) return null;
  if (actor.rawGuestToken) return hashToken(actor.rawGuestToken).slice(0, 16);
  return createHash("sha256").update(String(actor.id)).digest("hex").slice(0, 16);
}

export function bumpInviteFail(ipHash) {
  if (!ipHash) return 0;
  const key = ipHash;
  const n = (inviteFailBuckets.get(key) || 0) + 1;
  inviteFailBuckets.set(key, n);
  setTimeout(() => {
    const cur = inviteFailBuckets.get(key);
    if (cur) inviteFailBuckets.set(key, Math.max(0, cur - 1));
  }, 15 * 60 * 1000);
  return n;
}

export function inviteFailCount(ipHash) {
  return inviteFailBuckets.get(ipHash) || 0;
}

export async function buildSecurityCtx(req, actor, admin) {
  const ip = clientIp(req);
  const ip_hash = hashIp(ip);
  const ip_masked = maskIp(ip);
  const correlation_id = correlationId();
  const session_ref = sessionRef(actor);
  const consent = actor ? await hasRequiredConsent(admin, actor.id) : null;
  return {
    ip,
    ip_hash,
    ip_masked,
    correlation_id,
    session_ref,
    consent,
    ua: req.headers["user-agent"] || "",
  };
}

export async function ensureConsentForProtectedAction(
  admin,
  actor,
  body,
  req,
  pendingCookies,
) {
  const acceptedRequired =
    body.acceptedRequired === true || body.acceptedPolicies === true;
  const acceptedOptionalDevice = body.acceptedOptionalDevice === true;

  let consent = await hasRequiredConsent(admin, actor.id);
  if (!consent) {
    if (!acceptedRequired) {
      await requireSecurityConsent(admin, actor.id);
    }
    try {
      await recordSecurityConsent(admin, actor.id, {
        acceptedRequired: true,
        acceptedOptionalDevice,
        userAgent: req.headers["user-agent"],
      });
    } catch (err) {
      err.message =
        (err.message || "Consent recording failed") +
        " Please retry accepting the policies.";
      throw err;
    }
    consent = await hasRequiredConsent(admin, actor.id);
  }

  if (!consent?.required_accepted) {
    await requireSecurityConsent(admin, actor.id);
  }

  const optionalOk =
    consent.optional_device_accepted === true || acceptedOptionalDevice === true;
  const device = await ensureDeviceToken(
    admin,
    req,
    actor.id,
    optionalOk,
    pendingCookies,
  );

  return { consent, device, optionalOk };
}

export async function emitSecurityEvent(admin, req, actor, evt) {
  const ctx = await buildSecurityCtx(req, actor, admin);
  const risk = scoreRisk({
    isNewDevice: evt.isNewDevice,
    inviteFailCount: evt.inviteFailCount || inviteFailCount(ctx.ip_hash),
  });
  await logSecurityEvent(admin, {
    event_type: evt.event_type,
    severity: evt.severity || (risk.score >= 40 ? "high" : "info"),
    actor_id: actor?.id || null,
    transaction_id: evt.transaction_id || null,
    session_ref: ctx.session_ref,
    device_ref: evt.device_ref || null,
    ip_hash: ctx.ip_hash,
    ip_masked: ctx.ip_masked,
    user_agent: ctx.ua,
    correlation_id: ctx.correlation_id,
    risk_score: risk.score,
    risk_reasons: risk.reasons,
    payload: evt.payload || {},
  });
  return { ctx, risk };
}

export { CONSENT_BUNDLE_VERSION, hasRequiredConsent, requireSecurityConsent };
