/** What the room should ask this person to do next. */

export function nextStep({ status, role, accepted, paidWaiting, payoutReady }) {
  if (status === "disputed") {
    return {
      headline: "This trade is paused.",
      detail:
        "A dispute is already open. Use Messages to tell the other person what happened.",
      action: null,
    };
  }
  if (status === "completed") {
    return {
      headline: "This trade is finished.",
      detail: "Nothing else to do here.",
      action: null,
    };
  }
  if (status === "cancelled" || status === "expired") {
    return {
      headline: "This trade is closed.",
      detail: "Nothing else to do here.",
      action: null,
    };
  }
  if (status === "refunded") {
    return {
      headline: "This payment was refunded.",
      detail: "Nothing else to do here.",
      action: null,
    };
  }
  if (
    role === "seller" &&
    payoutReady === false &&
    !["completed", "cancelled", "expired", "refunded"].includes(status)
  ) {
    return {
      headline: "Add where you get paid.",
      detail: "Stripe sends the payment to that account. TradeSafe does not hold the money.",
      action: { act: "payout", label: "Add payout account" },
    };
  }
  if (status === "awaiting_acceptance") {
    if (!accepted && (role === "buyer" || role === "seller")) {
      return {
        headline: "Accept this trade.",
        detail: "Both people accept before anyone pays.",
        action: { act: "accept", label: "Accept this trade" },
      };
    }
    return {
      headline: "Waiting for the other person to accept.",
      detail: "You already accepted. This page updates when they do.",
      action: null,
    };
  }
  if (status === "awaiting_payment" || status === "payment_pending") {
    if (role === "buyer") {
      return {
        headline: "Pay with your card.",
        detail: paidWaiting
          ? "If you already paid, stay on this page. It updates when Stripe confirms the card."
          : "This opens Stripe to authorize the card. TradeSafe does not hold the money.",
        action: { act: "pay", label: "Pay now" },
      };
    }
    return {
      headline: "Waiting for the buyer to pay.",
      detail: "The card is authorized through Stripe. TradeSafe does not hold the money.",
      action: null,
    };
  }
  if (["awaiting_fulfillment", "funds_authorized", "in_fulfillment"].includes(status)) {
    if (role === "seller") {
      return {
        headline: "Tell the buyer you sent it.",
        detail: "Add a tracking number or a short note, then continue.",
        action: { act: "track", label: "I've sent it" },
        track: true,
      };
    }
    return {
      headline: "Waiting for the seller to send it.",
      detail: "You will confirm here after it arrives.",
      action: null,
    };
  }
  if (status === "awaiting_confirmation") {
    if (role === "buyer") {
      return {
        headline: "Confirm you received it.",
        detail: "This tells Stripe to capture the card authorization.",
        action: { act: "confirm", label: "I got it" },
      };
    }
    return {
      headline: "Waiting for the buyer to confirm.",
      detail: "The card stays authorized until they confirm.",
      action: null,
    };
  }
  if (status === "completion_pending") {
    return {
      headline: "Finishing the card payment.",
      detail: "Stripe is confirming the capture. This page updates when that is done.",
      action: null,
    };
  }
  return {
    headline: "Nothing to do right now.",
    detail: "This page updates when the trade changes.",
    action: null,
  };
}
