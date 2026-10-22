/** Cookie-aware API client (guest sessions use HttpOnly cookies).
 * Registered sessions also send Authorization: Bearer when present.
 */

async function authHeaders() {
  try {
    const { getSession } = await import("./supabase.js");
    const session = await getSession();
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` };
    }
  } catch {
    // Supabase unavailable — guest cookie path still works
  }
  return {};
}

export async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeaders()),
    ...(options.headers || {}),
  };
  const res = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || res.statusText || "Request failed");
    err.status = res.status;
    err.code = body.code;
    throw err;
  }
  return body;
}

export async function ensureGuest(displayName) {
  return api("/api/guest/session", {
    method: "POST",
    body: JSON.stringify({ display_name: displayName || undefined }),
  });
}
