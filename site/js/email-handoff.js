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

/** Continue a sign-in that this tab already requested. */
export function resumeEmailHandoff(nextPath) {
  const stored = readStored();
  if (!stored || stored.nextPath !== nextPath) return Promise.resolve(null);
  if (watching) return watching;
  return watch(stored);
}

function clearAuthParamsFromUrl() {
  const url = new URL(location.href);
  url.hash = "";
  for (const key of ["code", "token_hash", "type", "error", "error_description", "error_code"]) {
    url.searchParams.delete(key);
  }
  history.replaceState(null, "", `${url.pathname}${url.search}`);
}

/**
 * Turn the email-link URL into a local Supabase session.
 * Supports implicit hash tokens (cross-device) and same-tab PKCE/code fallbacks.
 */
async function adoptSession() {
  const sb = await getSupabase();
  let codeTried = false;

  for (let i = 0; i < 20; i++) {
    const { data: existing } = await sb.auth.getSession();
    if (existing.session?.access_token && existing.session.refresh_token) {
      clearAuthParamsFromUrl();
      return existing.session;
    }

    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (accessToken && refreshToken) {
      const { data, error } = await sb.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (!error && data.session) {
        clearAuthParamsFromUrl();
        return data.session;
      }
    }

    const params = new URLSearchParams(location.search);
    const tokenHash = params.get("token_hash");
    if (tokenHash) {
      const type = params.get("type") || "email";
      let result = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
      if (result.error && type !== "magiclink") {
        result = await sb.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      }
      if (!result.error && result.data.session) {
        clearAuthParamsFromUrl();
        return result.data.session;
      }
    }

    const code = params.get("code");
    if (code && !codeTried) {
      codeTried = true;
      const { data, error } = await sb.auth.exchangeCodeForSession(code);
      if (!error && data.session) {
        clearAuthParamsFromUrl();
        return data.session;
      }
    }

    await new Promise((r) => setTimeout(r, 100));
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
  if (!session?.access_token || !session.refresh_token) return { ok: false };
  if (!loginId) return { ok: true };
  let res = await postComplete(loginId, session);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1200));
    res = await postComplete(loginId, session);
  }
  if (!res.ok) return { ok: false, signedInHere: true };
  return { ok: true };
}
