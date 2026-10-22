export type SecurityHeaderOverrides = Record<string, string>;

const DEFAULT_SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-DNS-Prefetch-Control': 'off',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

export function applySecurityHeaders(
  headers: Headers,
  overrides?: SecurityHeaderOverrides,
): void {
  const merged = { ...DEFAULT_SECURITY_HEADERS, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
}

export function securityHeadersObject(
  overrides?: SecurityHeaderOverrides,
): Record<string, string> {
  return { ...DEFAULT_SECURITY_HEADERS, ...overrides };
}
