/** Platform take: 2.9% + $0.30, never at or above the trade amount. */

export function platformFeeCents(amountCents) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  if (amount < 1) return 0;
  const take = Math.round(amount * 0.029) + 30;
  return Math.min(take, Math.max(0, amount - 1));
}

export function sellerNetCents(amountCents) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  return Math.max(0, amount - platformFeeCents(amount));
}
