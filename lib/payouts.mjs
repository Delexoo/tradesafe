import { accountProblem, payoutProblem, safeReturnPath } from "./account-gate.mjs";

function prefsOf(row) {
  return row?.privacy_prefs && typeof row.privacy_prefs === "object" ? row.privacy_prefs : {};
}

export async function readPayout(admin, userId) {
  const { data } = await admin
    .from("ts_profiles")
    .select("privacy_prefs")
    .eq("id", userId)
    .maybeSingle();
  const prefs = prefsOf(data);
  return {
    accountId: prefs.stripe_account_id || null,
    ready: !!prefs.stripe_payouts_enabled && !!prefs.stripe_account_id,
    prefs,
  };
}

async function savePayout(admin, userId, prefs, patch) {
  await admin
    .from("ts_profiles")
    .update({ privacy_prefs: { ...prefs, ...patch } })
    .eq("id", userId);
}

export async function refreshPayout(admin, userId) {
  const current = await readPayout(admin, userId);
  if (!current.accountId || !process.env.STRIPE_SECRET_KEY) return current;
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const account = await stripe.accounts.retrieve(current.accountId);
  const ready = !!(account.payouts_enabled || account.details_submitted);
  if (ready !== current.ready) {
    await savePayout(admin, userId, current.prefs, { stripe_payouts_enabled: ready });
  }
  return { ...current, ready };
}

export async function createPayoutLink(admin, actor, origin, returnPath) {
  const blocked = accountProblem(actor);
  if (blocked) {
    const err = new Error(blocked);
    err.status = 403;
    err.code = "ACCOUNT_REQUIRED";
    throw err;
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    const err = new Error("Card payments are not set up on this server yet.");
    err.status = 503;
    throw err;
  }
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const current = await readPayout(admin, actor.id);
  let accountId = current.accountId;
  if (!accountId) {
    try {
      const account = await stripe.accounts.create({
        type: "express",
        email: actor.email || undefined,
        capabilities: { transfers: { requested: true } },
        metadata: { profile_id: actor.id },
      });
      accountId = account.id;
      await savePayout(admin, actor.id, current.prefs, {
        stripe_account_id: accountId,
        stripe_payouts_enabled: false,
      });
    } catch (err) {
      const wrapped = new Error(payoutProblem(err?.message));
      wrapped.status = 503;
      wrapped.code = "PAYOUT_UNAVAILABLE";
      throw wrapped;
    }
  }
  const back = `${origin}${safeReturnPath(returnPath)}`;
  try {
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: back,
      return_url: back,
      type: "account_onboarding",
    });
    return link.url;
  } catch (err) {
    const wrapped = new Error(payoutProblem(err?.message));
    wrapped.status = 503;
    wrapped.code = "PAYOUT_UNAVAILABLE";
    throw wrapped;
  }
}

export { accountProblem };
