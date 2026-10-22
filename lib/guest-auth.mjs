import { createHash, randomBytes, randomUUID } from "node:crypto";

export const GUEST_COOKIE = "ts_guest";
export const GUEST_TTL_DAYS = 30;

export function hashToken(raw) {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function guestCookieHeader(rawToken) {
  const maxAge = GUEST_TTL_DAYS * 86400;
  const secure =
    process.env.VERCEL || process.env.NODE_ENV === "production"
      ? "; Secure"
      : "";
  return `${GUEST_COOKIE}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/**
 * Resolve signed-in auth user or guest profile from cookie.
 * @returns {Promise<null | { id: string, display_name: string, is_guest: boolean, email?: string, rawGuestToken?: string }>}
 */
export async function resolveActor(req, admin) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const { data, error } = await admin.auth.getUser(token);
    if (!error && data.user) {
      return {
        id: data.user.id,
        email: data.user.email,
        display_name:
          data.user.user_metadata?.display_name ||
          data.user.email?.split("@")[0] ||
          "Trader",
        is_guest: false,
      };
    }
  }

  const cookies = parseCookies(req);
  const raw = cookies[GUEST_COOKIE];
  if (!raw) return null;
  const { data: session } = await admin
    .from("ts_guest_sessions")
    .select("id, profile_id, display_name, expires_at, revoked_at")
    .eq("token_hash", hashToken(raw))
    .maybeSingle();
  if (!session || session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  await admin
    .from("ts_guest_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", session.id);

  return {
    id: session.profile_id,
    display_name: session.display_name || "Guest",
    is_guest: true,
    rawGuestToken: raw,
  };
}

/** Create or refresh a guest session; may set Set-Cookie via pendingCookies array. */
export async function ensureGuestActor(req, admin, displayName, pendingCookies) {
  const existing = await resolveActor(req, admin);
  if (existing && !existing.is_guest) {
    if (displayName?.trim()) {
      await admin
        .from("ts_profiles")
        .update({ display_name: displayName.trim().slice(0, 80) })
        .eq("id", existing.id);
      existing.display_name = displayName.trim().slice(0, 80);
    }
    return existing;
  }
  if (existing?.is_guest) {
    const name = (displayName || existing.display_name || "Guest")
      .trim()
      .slice(0, 80);
    if (name && name !== existing.display_name) {
      await admin
        .from("ts_guest_sessions")
        .update({ display_name: name })
        .eq("token_hash", hashToken(existing.rawGuestToken));
      await admin
        .from("ts_profiles")
        .update({ display_name: name })
        .eq("id", existing.id);
      existing.display_name = name;
    }
    return existing;
  }

  const profileId = randomUUID();
  const name = (displayName || "Guest").trim().slice(0, 80) || "Guest";
  const { error: pErr } = await admin.from("ts_profiles").insert({
    id: profileId,
    display_name: name,
    is_guest: true,
  });
  if (pErr) throw new Error(pErr.message);

  const raw = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + GUEST_TTL_DAYS * 864e5).toISOString();
  const { data: sess, error: sErr } = await admin
    .from("ts_guest_sessions")
    .insert({
      token_hash: hashToken(raw),
      profile_id: profileId,
      display_name: name,
      expires_at: expires,
    })
    .select("id")
    .single();
  if (sErr) throw new Error(sErr.message);

  await admin
    .from("ts_profiles")
    .update({ guest_session_id: sess.id })
    .eq("id", profileId);

  pendingCookies.push(guestCookieHeader(raw));
  return {
    id: profileId,
    display_name: name,
    is_guest: true,
    rawGuestToken: raw,
  };
}

export async function getActivePolicies(admin) {
  const { data, error } = await admin
    .from("ts_policy_versions")
    .select("id, policy_key, version, title, content_hash, body_summary")
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Server-authoritative policy acceptance. Client may only send acceptedPolicies: true.
 * Versions and hashes come from the database, never the browser.
 */
export async function recordPlatformPolicyAcceptance(
  admin,
  actorId,
  { transactionId = null, userAgent = null, acceptedPolicies },
) {
  if (acceptedPolicies !== true) {
    const err = new Error(
      "You must accept the Terms of Service, Privacy Policy, and Transaction and Dispute Policies.",
    );
    err.status = 400;
    throw err;
  }
  const policies = await getActivePolicies(admin);
  if (policies.length < 3) {
    throw new Error("Policy versions are not configured");
  }
  const required = ["tos", "privacy", "transaction_dispute"];
  for (const key of required) {
    if (!policies.some((p) => p.policy_key === key)) {
      throw new Error(`Missing active policy: ${key}`);
    }
  }
  const rows = policies
    .filter((p) => required.includes(p.policy_key))
    .map((p) => ({
      actor_id: actorId,
      policy_version_id: p.id,
      policy_key: p.policy_key,
      policy_version: p.version,
      content_hash: p.content_hash,
      transaction_id: transactionId,
      method: "checkbox",
      user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
    }));
  const { error } = await admin.from("ts_policy_acceptances").insert(rows);
  if (error) throw new Error(error.message);
  return rows.map((r) => ({
    policy_key: r.policy_key,
    policy_version: r.policy_version,
  }));
}
