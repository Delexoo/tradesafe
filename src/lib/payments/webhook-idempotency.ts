export type WebhookInsertOutcome = 'inserted' | 'duplicate_unprocessed' | 'duplicate_processed';

export interface ExistingWebhookRow {
  processed_at: string | null;
}

/**
 * Decide how to handle a Stripe (or other) webhook after a DB upsert/insert attempt.
 */
export function resolveWebhookIdempotency(
  insertSucceeded: boolean,
  existing: ExistingWebhookRow | null,
): { outcome: WebhookInsertOutcome; shouldProcess: boolean } {
  if (insertSucceeded) {
    return { outcome: 'inserted', shouldProcess: true };
  }

  if (!existing) {
    return { outcome: 'duplicate_unprocessed', shouldProcess: true };
  }

  if (existing.processed_at) {
    return { outcome: 'duplicate_processed', shouldProcess: false };
  }

  return { outcome: 'duplicate_unprocessed', shouldProcess: true };
}

export function webhookEventKey(provider: string, eventId: string): string {
  return `${provider}:${eventId}`;
}
