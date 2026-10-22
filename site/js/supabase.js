import { createClient } from "/js/vendor/supabase-js.js";
import { getConfig } from "./config.js";

let client = null;

export async function getSupabase() {
  if (client) return client;
  const cfg = await getConfig();
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Implicit puts tokens in the email link hash so another device can finish
      // verify. PKCE keeps the code verifier on the device that requested the link.
      flowType: "implicit",
    },
  });
  return client;
}

export async function requireUser() {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/login.html?next=${next}`;
    throw new Error("Unauthorized");
  }
  return { supabase: sb, user: data.user };
}

export async function getSession() {
  const sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  return data.session;
}

/**
 * Wait until Supabase has finished reading storage (INITIAL_SESSION),
 * then return a session with a user — or null.
 */
export async function waitForAuthSession(timeoutMs = 4000) {
  const sb = await getSupabase();
  const first = await getSession();
  if (first?.user) return first;

  const { data: userData } = await sb.auth.getUser();
  if (userData?.user) {
    const again = await getSession();
    if (again?.user) return again;
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (session) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subscription.unsubscribe();
      resolve(session?.user ? session : null);
    };
    const timer = setTimeout(async () => {
      const late = await getSession();
      finish(late);
    }, timeoutMs);
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        finish(session);
        return;
      }
      if (event === "INITIAL_SESSION") finish(null);
    });
    const subscription = data.subscription;
  });
}

export async function api(path, options = {}) {
  const session = await getSession();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const res = await fetch(path, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || res.statusText || "Request failed");
  }
  return body;
}
