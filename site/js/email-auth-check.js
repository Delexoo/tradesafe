const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailProblem(value) {
  const email = String(value ?? "").trim();
  if (!email) return "Enter your email.";
  if (!EMAIL_RE.test(email)) return "Enter a valid email address.";
  return null;
}

export function safeNextPath(search = "") {
  const next = new URLSearchParams(search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/dashboard.html";
  return next;
}
