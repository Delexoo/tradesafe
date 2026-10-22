import { createAdminClient } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api/errors';
import { isDemoModeEnabled } from './demo';
import { createStripeCheckoutSession } from './stripe';

export async function createPaymentSessionForTransaction(
  userId: string,
  transactionId: string,
  origin: string,
): Promise<{ provider: string; sessionId?: string; url?: string | null }> {
  const admin = createAdminClient();

  const { data: tx, error } = await admin
    .from('ts_transactions')
    .select('id, reference_code, amount_cents, currency, status, is_demo')
    .eq('id', transactionId)
    .single();

  if (error || !tx) {
    throw new ApiError('Transaction not found', 404);
  }

  const { data: participant } = await admin
    .from('ts_participants')
    .select('role')
    .eq('transaction_id', transactionId)
    .eq('user_id', userId)
    .eq('status', 'joined')
    .maybeSingle();

  if (!participant || participant.role !== 'buyer') {
    throw new ApiError('Only the buyer can start payment', 403);
  }

  if (tx.is_demo && isDemoModeEnabled()) {
    return { provider: 'demo', url: null };
  }

  if (tx.is_demo) {
    throw new ApiError('Demo trades require DEMO_MODE on the server', 400);
  }

  const { sessionId, url } = await createStripeCheckoutSession({
    transactionId: tx.id as string,
    referenceCode: tx.reference_code as string,
    amountCents: tx.amount_cents as number,
    currency: tx.currency as string,
    successUrl: `${origin}/trades/${transactionId}?payment=success`,
    cancelUrl: `${origin}/trades/${transactionId}?payment=cancelled`,
  });

  const { data: payRow } = await admin
    .from('ts_payments')
    .select('id')
    .eq('transaction_id', transactionId)
    .maybeSingle();

  if (payRow?.id) {
    await admin
      .from('ts_payments')
      .update({
        provider: 'stripe',
        provider_session_id: sessionId,
        status: 'initiated',
        updated_at: new Date().toISOString(),
      })
      .eq('id', payRow.id);
  } else {
    await admin.from('ts_payments').insert({
      transaction_id: transactionId,
      provider: 'stripe',
      provider_session_id: sessionId,
      amount_cents: tx.amount_cents,
      currency: tx.currency,
      status: 'initiated',
    });
  }

  return { provider: 'stripe', sessionId, url };
}
