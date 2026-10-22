import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertTransition,
  type TransactionAction,
} from '@/lib/state-machine';
import type { PaymentStatus, TransactionStatus } from '@/lib/types';
import { milestoneKeysForStatus } from '@/lib/progress';
import { resolveWebhookIdempotency } from './webhook-idempotency';

async function applyMilestones(
  admin: SupabaseClient,
  transactionId: string,
  status: TransactionStatus,
): Promise<void> {
  const updates = milestoneKeysForStatus(status);
  for (const u of updates) {
    await admin
      .from('ts_milestones')
      .update({ status: u.status, completed_at: new Date().toISOString() })
      .eq('transaction_id', transactionId)
      .eq('key', u.key);
  }
}

async function transitionTx(
  admin: SupabaseClient,
  transactionId: string,
  to: TransactionStatus,
  action: TransactionAction,
): Promise<void> {
  const { data: tx } = await admin
    .from('ts_transactions')
    .select('status')
    .eq('id', transactionId)
    .single();

  if (!tx) {
    throw new Error('Transaction missing for webhook');
  }

  const from = tx.status as TransactionStatus;
  assertTransition(from, to, {
    source: 'provider',
    action,
    actorRole: 'creator',
  });

  await admin
    .from('ts_transactions')
    .update({ status: to, updated_at: new Date().toISOString() })
    .eq('id', transactionId);

  await applyMilestones(admin, transactionId, to);
}

export async function recordWebhookEvent(
  admin: SupabaseClient,
  provider: string,
  event: Stripe.Event,
): Promise<{ shouldProcess: boolean; webhookRowId?: string }> {
  const { data: inserted, error } = await admin
    .from('ts_webhook_events')
    .insert({
      provider,
      event_id: event.id,
      event_type: event.type,
      payload: event as unknown as Record<string, unknown>,
    })
    .select('id, processed_at')
    .maybeSingle();

  if (!error && inserted) {
    return { shouldProcess: true, webhookRowId: inserted.id as string };
  }

  const { data: existing } = await admin
    .from('ts_webhook_events')
    .select('id, processed_at')
    .eq('provider', provider)
    .eq('event_id', event.id)
    .maybeSingle();

  const { shouldProcess } = resolveWebhookIdempotency(false, existing ?? null);
  return {
    shouldProcess,
    webhookRowId: existing?.id as string | undefined,
  };
}

export async function markWebhookProcessed(
  admin: SupabaseClient,
  webhookRowId: string,
  processingError?: string,
): Promise<void> {
  await admin
    .from('ts_webhook_events')
    .update({
      processed_at: new Date().toISOString(),
      processing_error: processingError ?? null,
    })
    .eq('id', webhookRowId);
}

export async function handleStripePaymentEvent(
  admin: SupabaseClient,
  event: Stripe.Event,
): Promise<void> {
  let transactionId: string | undefined;
  let paymentStatus: PaymentStatus | undefined;
  let providerPaymentId: string | undefined;
  let txTarget: TransactionStatus | undefined;
  let txAction: TransactionAction | undefined;

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    transactionId = session.metadata?.transaction_id;
    providerPaymentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    paymentStatus = 'pending';
    txTarget = 'payment_pending';
    txAction = 'initiate_payment';
  } else if (event.type === 'payment_intent.amount_capturable_updated') {
    const pi = event.data.object as Stripe.PaymentIntent;
    transactionId = pi.metadata?.transaction_id;
    providerPaymentId = pi.id;
    paymentStatus = 'authorized';
    txTarget = 'funds_authorized';
    txAction = 'payment_authorized';
  } else if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object as Stripe.PaymentIntent;
    transactionId = pi.metadata?.transaction_id;
    providerPaymentId = pi.id;
    paymentStatus = 'failed';
    txTarget = 'awaiting_payment';
    txAction = 'payment_failed';
  } else if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent;
    transactionId = pi.metadata?.transaction_id;
    providerPaymentId = pi.id;
    paymentStatus = 'captured';
    txTarget = 'completed';
    txAction = 'capture_completed';
  }

  if (!transactionId || !paymentStatus) {
    return;
  }

  const { data: tx } = await admin
    .from('ts_transactions')
    .select('is_demo, status')
    .eq('id', transactionId)
    .single();

  if (!tx || tx.is_demo) {
    throw new Error('Stripe webhook ignored for demo or missing transaction');
  }

  const paymentPatch: Record<string, unknown> = {
    status: paymentStatus,
    provider_payment_id: providerPaymentId,
    updated_at: new Date().toISOString(),
  };
  if (paymentStatus === 'authorized') {
    paymentPatch.authorized_at = new Date().toISOString();
  }
  if (paymentStatus === 'captured') {
    paymentPatch.captured_at = new Date().toISOString();
  }

  await admin
    .from('ts_payments')
    .update(paymentPatch)
    .eq('transaction_id', transactionId);

  if (txTarget && txAction) {
    const from = tx.status as TransactionStatus;
    if (from !== txTarget) {
      await transitionTx(admin, transactionId, txTarget, txAction);
    }
  }

  await admin.from('ts_events').insert({
    transaction_id: transactionId,
    event_type: 'payment_webhook',
    summary: `Stripe ${event.type}`,
    payload: { event_id: event.id, payment_status: paymentStatus },
    verification_source: 'provider_confirmed',
  });
}
