/** Cookie-aware API client (guest sessions use HttpOnly cookies). */

export async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
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
