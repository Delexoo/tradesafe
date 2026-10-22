import type { SupabaseClient } from '@supabase/supabase-js';

export function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE === 'true';
}

export async function ensureDemoPaymentRow(
  admin: SupabaseClient,
  transactionId: string,
  amountCents: number,
  currency: string,
): Promise<string> {
  const { data: existing } = await admin
    .from('ts_payments')
    .select('id')
    .eq('transaction_id', transactionId)
    .maybeSingle();

  if (existing?.id) {
    return existing.id as string;
  }

  const { data, error } = await admin
    .from('ts_payments')
    .insert({
      transaction_id: transactionId,
      provider: 'demo',
      amount_cents: amountCents,
      currency,
      status: 'none',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Demo payment row failed: ${error?.message}`);
  }
  return data.id as string;
}
