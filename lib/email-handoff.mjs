import { createHash, timingSafeEqual } from "node:crypto";
import { emailProblem } from "./email-auth-check.mjs";

const HEX_32 = /^[a-f0-9]{32}$/;
const HANDOFF_MS = 15 * 60 * 1000;

export function handoffProblem({ id, secret, email }) {
  if (!HEX_32.test(String(id || "")) || !HEX_32.test(String(secret || ""))) {
    return "That sign-in link is not valid.";
  }
  return emailProblem(email);
}

export function hashHandoffSecret(secret) {
  return createHash("sha256").update(String(secret)).digest("hex");
}

export function secretMatches(storedHash, secret) {
  try {
    const a = Buffer.from(String(storedHash || ""), "hex");
    const b = Buffer.from(hashHandoffSecret(secret), "hex");
    if (a.length === 0 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Only same-site paths can be the page we return to after the email link. */
export function verifiedNextPath(value) {
  const path = String(value || "");
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    return "/dashboard.html";
  }
  return path;
}

export function handoffRedirect(origin, nextPath, id) {
  const url = new URL("/verified.html", origin);
  url.searchParams.set("login", id);
  url.searchParams.set("next", verifiedNextPath(nextPath));
  return url.toString();
}

function handoffError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function createEmailHandoff(admin, input) {
  const problem = handoffProblem(input);
  if (problem) throw handoffError(problem, 400);
  const now = new Date();
  await admin.from("ts_email_handoffs").delete().lt("expires_at", now.toISOString());
  const { error } = await admin.from("ts_email_handoffs").insert({
    id: input.id,
    secret_hash: hashHandoffSecret(input.secret),
    email: String(input.email).trim().toLowerCase(),
    expires_at: new Date(now.getTime() + HANDOFF_MS).toISOString(),
  });
  if (error) throw handoffError("Could not start email sign-in. Try again.", 503);
  return { ok: true };
}

export async function completeEmailHandoff(admin, { id, accessToken, refreshToken }) {
  if (!HEX_32.test(String(id || "")) || !accessToken || !refreshToken) {
    throw handoffError("That sign-in link is not valid.", 400);
  }
  const { data: row, error: readError } = await admin
    .from("ts_email_handoffs")
    .select("id, email, expires_at, access_token")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw handoffError("Could not finish email sign-in. Try again.", 503);
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    throw handoffError("That sign-in link expired. Request a new one.", 410);
  }
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  const email = userData?.user?.email?.trim().toLowerCase();
  if (userError || !email || email !== row.email) {
    throw handoffError("That email link does not match this sign-in.", 401);
  }
  if (row.access_token) return { ok: true };
  const { error } = await admin
    .from("ts_email_handoffs")
    .update({ access_token: accessToken, refresh_token: refreshToken })
    .eq("id", id)
    .is("access_token", null);
  if (error) throw handoffError("Could not finish email sign-in. Try again.", 503);
  return { ok: true };
}

export async function claimEmailHandoff(admin, { id, secret }) {
  if (!HEX_32.test(String(id || "")) || !HEX_32.test(String(secret || ""))) {
    throw handoffError("That sign-in link is not valid.", 400);
  }
  const { data: row, error } = await admin
    .from("ts_email_handoffs")
    .select("id, secret_hash, access_token, refresh_token, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw handoffError("Could not check email sign-in. Try again.", 503);
  if (!row || !secretMatches(row.secret_hash, secret)) {
    throw handoffError("That sign-in link is not valid.", 404);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await admin.from("ts_email_handoffs").delete().eq("id", id);
    return { status: "expired" };
  }
  if (!row.access_token || !row.refresh_token) return { status: "pending" };
  const { data: claimed, error: claimError } = await admin
    .from("ts_email_handoffs")
    .delete()
    .eq("id", id)
    .eq("secret_hash", row.secret_hash)
    .select("access_token, refresh_token")
    .maybeSingle();
  if (claimError) throw handoffError("Could not check email sign-in. Try again.", 503);
  if (!claimed?.access_token) return { status: "pending" };
  return {
    status: "ready",
    access_token: claimed.access_token,
    refresh_token: claimed.refresh_token,
  };
}
