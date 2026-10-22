export function money(cents, currency = "usd") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format((cents || 0) / 100);
  } catch {
    return `$${((cents || 0) / 100).toFixed(2)}`;
  }
}

/** Platform take: 2.9% + $0.30, never at or above the trade amount. */
export function platformFeeCents(amountCents) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  if (amount < 1) return 0;
  const fee = Math.round(amount * 0.029) + 30;
  return Math.min(fee, Math.max(0, amount - 1));
}

export function sellerNetCents(amountCents) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  return Math.max(0, amount - platformFeeCents(amount));
}

export function statusLabel(status) {
  return String(status || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name) {
  const parts = String(name || "T").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "T";
}

export function buyerProgress(tx, payment, milestones = []) {
  const done = (key) =>
    milestones.some((m) => m.key === key && m.status === "completed");
  const pay = payment?.status || "none";
  const st = tx?.status || "";
  const flags = [
    done("buyer_terms_accepted"),
    done("buyer_payment_initiated") ||
      ["initiated", "pending", "authorized", "captured"].includes(pay),
    done("buyer_payment_authorized") ||
      ["authorized", "captured"].includes(pay),
    ["awaiting_fulfillment", "in_fulfillment", "awaiting_confirmation", "completion_pending", "completed"].includes(
      st,
    ) || ["authorized", "captured"].includes(pay),
    done("buyer_receipt_confirmed") ||
      ["completion_pending", "completed"].includes(st),
    st === "completed" || pay === "captured",
  ];
  const n = flags.filter(Boolean).length;
  return Math.round((n / flags.length) * 100);
}

export function sellerProgress(fulfillment, milestones = []) {
  const done = (key) =>
    milestones.some((m) => m.key === key && m.status === "completed");
  const f = fulfillment?.status || "not_started";
  const flags = [
    done("seller_terms_accepted"),
    done("seller_fulfillment_acknowledged") ||
      ["acknowledged", "preparing", "shipped", "transferred", "delivered", "confirmed"].includes(
        f,
      ),
    f === "preparing" ||
      ["shipped", "transferred", "delivered", "confirmed"].includes(f),
    done("seller_shipped") ||
      done("seller_digital_transfer") ||
      ["shipped", "transferred", "delivered", "confirmed"].includes(f),
    done("seller_delivery_complete") ||
      ["delivered", "confirmed"].includes(f),
    f === "confirmed",
  ];
  const n = flags.filter(Boolean).length;
  return Math.round((n / flags.length) * 100);
}
