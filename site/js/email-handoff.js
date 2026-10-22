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
        if (err.status === 404 || err.status === 400) finish(null);
      } finally {
        busy = false;
      }
    };
    timer = setInterval(tick, 2000);
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

async function adoptSession() {
  const sb = await getSupabase();
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    return;
  }
  const params = new URLSearchParams(location.search);
  const tokenHash = params.get("token_hash");
  if (tokenHash) {
    await sb.auth.verifyOtp({
      token_hash: tokenHash,
      type: params.get("type") || "magiclink",
    });
    return;
  }
  const code = params.get("code");
  if (code) await sb.auth.exchangeCodeForSession(code).catch(() => {});
}

/** The browser that opened the email link gives the session back to the requester. */
export async function finishEmailHandoff(loginId) {
  await adoptSession();
  const session = await getSession();
  if (!session?.access_token || !session.refresh_token) return { ok: false };
  if (!loginId) return { ok: true };
  const res = await fetch("/api/auth/email-handoff/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: loginId,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
  });
  if (!res.ok) return { ok: false, signedInHere: true };
  return { ok: true };
}
