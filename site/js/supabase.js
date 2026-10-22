import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
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
