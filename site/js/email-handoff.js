import { getSession, getSupabase } from "./supabase.js";

const STORAGE_KEY = "ts-email-handoff";
const WAIT_MS = 15 * 60 * 1000;

function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readStored() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

let stopWatch = () => {};
let watching = null;

async function claim(stored) {
  const res = await fetch("/api/auth/email-handoff/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: stored.id, secret: stored.secret }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || "Could not check email sign-in.");
    err.status = res.status;
    throw err;
  }
  return body;
}

function watch(stored) {
  stopWatch();
  watching = new Promise((resolve) => {
    const started = Date.now();
    let timer = 0;
    let stopped = false;
    const finish = (session) => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      sessionStorage.removeItem(STORAGE_KEY);
      resolve(session);
    };
    stopWatch = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      resolve({ replaced: true });
    };
    let busy = false;
    const tick = async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        const result = await claim(stored);
        if (result.status === "ready") {
          const sb = await getSupabase();
          const { data, error } = await sb.auth.setSession({
            access_token: result.access_token,
            refresh_token: result.refresh_token,
          });
          if (!error && data.session?.user) {
            finish(data.session);
            return;
          }
        }
        const local = await getSession();
        if (local?.user) {
          finish(local);
          return;
        }
        if (result.status === "expired" || Date.now() - started > WAIT_MS) finish(null);
      } catch (err) {
        // 429: keep polling (claim is intentionally frequent).
        if (err.status === 404 || err.status === 400 || err.status === 410) {
          finish(null);
        }
      } finally {
        busy = false;
      }
    };
    timer = setInterval(tick, 3000);
    tick();
  });
  return watching;
}

const KNOWN_EMAILS_KEY = "ts-known-emails";

export function rememberEmailAccount(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return;
  try {
    const list = JSON.parse(localStorage.getItem(KNOWN_EMAILS_KEY) || "[]");
    const next = [normalized, ...list.filter((e) => e !== normalized)].slice(0, 20);
    localStorage.setItem(KNOWN_EMAILS_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

/** True when this browser has successfully signed in with that email before. */
export function accountDetectedForEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  try {
    const list = JSON.parse(localStorage.getItem(KNOWN_EMAILS_KEY) || "[]");
    return Array.isArray(list) && list.includes(normalized);
  } catch {
    return false;
  }
}

function noAccountError(error) {
  const text = String(error?.message || error || "");
  return /signups not allowed|user not found|not found|unable to validate/i.test(text);
}

/** Ask for the email link and keep this browser signed in once it is opened. */
export async function sendEmailLink({ email, shouldCreateUser, nextPath }) {
  const id = randomId();
  const secret = randomId();
  const stored = { id, secret, nextPath };
  const created = await fetch("/api/auth/email-handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, secret, email }),
  });
  const createdBody = await created.json().catch(() => ({}));
  if (!created.ok) throw new Error(createdBody.error || "Could not start email sign-in.");
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  const redirect = `${location.origin}/verified.html?login=${encodeURIComponent(id)}&next=${encodeURIComponent(nextPath)}`;
  const sb = await getSupabase();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser,
      emailRedirectTo: redirect,
    },
  });
  if (error) throw error;
  return { whenSignedIn: watch(stored) };
}

/**
 * Login when this browser knows the email; otherwise sign up.
 * Always allow create on the OTP call so existing and new accounts both get a link.
 * Falls back the other way if Supabase rejects the first attempt.
 */
export async function sendEmailLinkAuto({ email, nextPath }) {
  const known = accountDetectedForEmail(email);
  const mode = known ? "login" : "signup";
  try {
    // shouldCreateUser:true works for both new and returning users.
    const result = await sendEmailLink({
      email,
      shouldCreateUser: true,
      nextPath,
    });
    return { ...result, mode };
  } catch (err) {
    if (noAccountError(err)) {
      const result = await sendEmailLink({
        email,
        shouldCreateUser: true,
        nextPath,
      });
      return { ...result, mode: "signup" };
    }
    if (/already|registered|exists|signups not allowed/i.test(String(err?.message || ""))) {
      const result = await sendEmailLink({
        email,
        shouldCreateUser: false,
        nextPath,
      });
      return { ...result, mode: "login" };
    }
    throw err;
  }
}

/** Continue a sign-in that this tab already requested. */
export function resumeEmailHandoff(nextPath) {
  const stored = readStored();
  if (!stored || stored.nextPath !== nextPath) return Promise.resolve(null);
  if (watching) return watching;
  return watch(stored);
}

export function readEmailHandoffStored() {
  return readStored();
}

function clearAuthParamsFromUrl() {
  const url = new URL(location.href);
  url.hash = "";
  for (const key of [
    "code",
    "token_hash",
    "type",
    "error",
    "error_description",
    "error_code",
    "access_token",
    "refresh_token",
  ]) {
    url.searchParams.delete(key);
  }
  history.replaceState(null, "", `${url.pathname}${url.search}`);
}

/** Snapshot hash + query before the Supabase client can strip the URL. */
function captureAuthCallback() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(location.search);
  return {
    access_token: hash.get("access_token") || query.get("access_token"),
    refresh_token: hash.get("refresh_token") || query.get("refresh_token"),
    token_hash: query.get("token_hash") || hash.get("token_hash"),
    type: query.get("type") || hash.get("type") || "email",
    code: query.get("code") || hash.get("code"),
    error: query.get("error") || hash.get("error"),
    error_description: query.get("error_description") || hash.get("error_description"),
  };
}

/**
 * Turn the email-link URL into a local Supabase session.
 * Supports implicit hash tokens (cross-device) and same-tab PKCE/code fallbacks.
 */
async function adoptSession() {
  // Must run before await getSupabase() — detectSessionInUrl clears the hash.
  const callback = captureAuthCallback();
  if (callback.error) {
    console.warn("Auth callback error", callback.error, callback.error_description);
    return null;
  }

  const sb = await getSupabase();

  if (callback.access_token && callback.refresh_token) {
    const { data, error } = await sb.auth.setSession({
      access_token: callback.access_token,
      refresh_token: callback.refresh_token,
    });
    if (!error && data.session) {
      clearAuthParamsFromUrl();
      return data.session;
    }
  }

  if (callback.token_hash) {
    const types = [...new Set([callback.type, "email", "magiclink", "signup", "invite"])];
    for (const type of types) {
      const result = await sb.auth.verifyOtp({
        token_hash: callback.token_hash,
        type,
      });
      if (!result.error && result.data.session) {
        clearAuthParamsFromUrl();
        return result.data.session;
      }
    }
  }

  if (callback.code) {
    const { data, error } = await sb.auth.exchangeCodeForSession(callback.code);
    if (!error && data.session) {
      clearAuthParamsFromUrl();
      return data.session;
    }
  }

  for (let i = 0; i < 25; i++) {
    const { data: existing } = await sb.auth.getSession();
    if (existing.session?.access_token && existing.session.refresh_token) {
      clearAuthParamsFromUrl();
      return existing.session;
    }
    await new Promise((r) => setTimeout(r, 80));
  }

  const { data } = await sb.auth.getSession();
  return data.session || null;
}

async function postComplete(loginId, session) {
  const res = await fetch("/api/auth/email-handoff/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: loginId,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
  });
  return res;
}

/** The browser that opened the email link gives the session back to the requester. */
export async function finishEmailHandoff(loginId) {
  const session = await adoptSession();
  if (!session?.access_token || !session.refresh_token) {
    return { ok: false, session: null };
  }
  if (session.user?.email) rememberEmailAccount(session.user.email);

  if (!loginId) {
    return { ok: true, session, signedInHere: true };
  }

  let res = await postComplete(loginId, session);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1200));
    res = await postComplete(loginId, session);
  }
  if (!res.ok) {
    return { ok: false, signedInHere: true, session };
  }
  return { ok: true, session };
}
