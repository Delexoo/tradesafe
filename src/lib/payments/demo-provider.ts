import { randomUUID } from 'node:crypto';

import type { PaymentStatus } from '../types';
import type {
  PaymentIntentSnapshot,
  PaymentProvider,
  PaymentSession,
  RefundRequest,
  ReleaseRequest,
  WebhookVerificationResult,
} from './types';

/**
 * Simulated payment provider for development and demos.
 * Does not move real money — all statuses are explicitly fake.
 */
export class DemoPaymentProvider implements PaymentProvider {
  readonly id = 'demo' as const;

  private readonly store = new Map<string, PaymentIntentSnapshot>();
  private readonly sessionToPayment = new Map<string, string>();

  async createSession(input: {
    transactionId: string;
    amountCents: number;
    currency: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentSession> {
    const sessionId = `demo_sess_${randomUUID()}`;
    const providerPaymentId = `demo_pi_${randomUUID()}`;

    this.store.set(providerPaymentId, {
      providerPaymentId,
      status: 'initiated',
      amountCents: input.amountCents,
      currency: input.currency,
    });
    this.sessionToPayment.set(sessionId, providerPaymentId);

    return {
      provider: 'demo',
      sessionId,
      clientSecret: `demo_secret_${providerPaymentId}`,
      metadata: {
        simulated: 'true',
        transaction_id: input.transactionId,
        ...input.metadata,
      },
    };
  }

  async initiatePayment(input: {
    sessionId: string;
    transactionId: string;
  }): Promise<PaymentIntentSnapshot> {
    const paymentId = this.sessionToPayment.get(input.sessionId);
    const snapshot = paymentId
      ? await this.getStatus(paymentId)
      : {
          providerPaymentId: `demo_pi_${randomUUID()}`,
          status: 'pending' as PaymentStatus,
          amountCents: 0,
          currency: 'usd',
        };

    const updated: PaymentIntentSnapshot = {
      ...snapshot,
      status: 'authorized',
      authorizedAt: new Date().toISOString(),
    };
    this.store.set(updated.providerPaymentId, updated);
    return updated;
  }

  async getStatus(providerPaymentId: string): Promise<PaymentIntentSnapshot> {
    const row = this.store.get(providerPaymentId);
    if (!row) {
      throw new Error(
        `[DemoPaymentProvider] Unknown simulated payment id: ${providerPaymentId}`,
      );
    }
    return row;
  }

  async requestRelease(input: ReleaseRequest): Promise<PaymentIntentSnapshot> {
    const row = await this.getStatus(input.providerPaymentId);
    const updated: PaymentIntentSnapshot = {
      ...row,
      status: 'captured',
      capturedAt: new Date().toISOString(),
    };
    this.store.set(input.providerPaymentId, updated);
    return updated;
  }

  async requestRefund(input: RefundRequest): Promise<PaymentIntentSnapshot> {
    const row = await this.getStatus(input.providerPaymentId);
    const updated: PaymentIntentSnapshot = {
      ...row,
      status: 'refunded',
    };
    this.store.set(input.providerPaymentId, updated);
    return updated;
  }

  async verifyWebhook(
    _payload: string | Buffer,
    _signature: string,
  ): Promise<WebhookVerificationResult> {
    return {
      ok: true,
      eventType: 'demo.simulated_webhook',
    };
  }
}
