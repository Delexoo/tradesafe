import { randomBytes } from 'crypto';

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Human-readable trade reference: `TS-` + 8 alphanumeric chars (no ambiguous 0/O/1/I). */
export function generateReferenceCode(): string {
  const bytes = randomBytes(8);
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += REF_CHARS[bytes[i]! % REF_CHARS.length];
  }
  return `TS-${suffix}`;
}

export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
