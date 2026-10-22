/** Who may start a trade, and how payout errors are shown. */

export function accountProblem(actor) {
  if (!actor || actor.is_guest) {
    return "Create an account before starting a trade.";
  }
  return null;
}

export function payoutProblem(message) {
  const text = String(message || "");
  if (/permission|connected account|connected_account/i.test(text)) {
    return "Stripe is not allowed to add payout accounts with the current key yet.";
  }
  return "Could not open the payout account. Try again.";
}

export function safeReturnPath(value, fallback = "/create.html") {
  const path = String(value || "");
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) return fallback;
  return path;
}
