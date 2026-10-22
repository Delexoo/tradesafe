/** What the room should ask this person to do next. */
import { money } from "./format.js";

export function fulfillCopy(category, terms = {}) {
  const cat = category || terms.category || "other";
  if (cat === "digital") {
    return {
      headline: "Send the digital delivery.",
      detail: terms.preview_url
        ? "Share the final file or access link. A preview was listed when this trade was created."
        : "Share the final file, link, or account handoff details.",
      label: "I've delivered it",
      mode: "digital",
      placeholder: "Delivery link or how they get access",
    };
  }
  if (cat === "website_domain") {
    return {
      headline: "Complete the domain transfer.",
      detail: terms.domain_name
        ? `Confirm you sent the auth code or finished DNS for ${terms.domain_name}.`
        : "Confirm you sent the auth code or finished DNS for the domain.",
      label: "Transfer started",
      mode: "domain",
      placeholder: "Auth code sent, unlock done, DNS notes…",
    };
  }
  if (cat === "service") {
    return {
      headline: "Mark the work complete.",
      detail: terms.service_scope
        ? `Done means: ${terms.service_scope}`
        : "Add a short note about what you finished.",
      label: "Work is done",
      mode: "service",
      placeholder: "What you completed",
    };
  }
  if (["physical", "electronics", "collectibles"].includes(cat)) {
    const other = terms.ship_mode === "other";
    return {
      headline: other ? "Confirm you handed it over." : "Tell the buyer you shipped it.",
      detail: other
        ? "Describe how it was delivered (no carrier tracking required)."
        : "Add a carrier tracking number, or switch to other delivery if there is no official tracking.",
      label: "I've sent it",
      mode: other ? "ship_other" : "ship_carrier",
      placeholder: other ? "How you handed it over" : "Tracking number",
    };
  }
  return {
    headline: "Tell the buyer you sent it.",
    detail: "Add a tracking number or a short note, then continue.",
    label: "I've sent it",
    mode: "other",
    placeholder: "Tracking number, or how you handed it over",
  };
}

export function nextStep({
  status,
  role,
  accepted,
  paidWaiting,
  payoutReady,
  category,
  terms,
  amountCents,
  currency,
  feeCents,
  netCents,
}) {
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
      detail:
        "Finish Stripe Connect so Stripe can send your share (listed amount minus TradeSafe’s 2.9% + $0.30). TradeSafe does not hold the money.",
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
      const feeNote =
        Number.isFinite(amountCents) && amountCents > 0
          ? ` You pay ${money(amountCents, currency)}; the seller receives about ${money(netCents, currency)} after TradeSafe’s fee of ${money(feeCents, currency)}.`
          : "";
      return {
        headline: "Pay with your card.",
        detail: paidWaiting
          ? "If you already paid, stay on this page. It updates when Stripe confirms the card."
          : `This opens Stripe to authorize the card.${feeNote} TradeSafe does not hold the money.`,
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
      const copy = fulfillCopy(category, terms);
      return {
        headline: copy.headline,
        detail: copy.detail,
        action: { act: "track", label: copy.label },
        track: true,
        trackMode: copy.mode,
        trackPlaceholder: copy.placeholder,
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
