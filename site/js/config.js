/** Public runtime config from the server (never includes service role). */
let cached = null;

export async function getConfig() {
  if (cached) return cached;
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Could not load app config");
  cached = await res.json();
  return cached;
}
