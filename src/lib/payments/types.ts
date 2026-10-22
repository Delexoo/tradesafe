import type { PaymentStatus } from '../types';

export type PaymentProviderId = 'demo' | 'stripe';

export interface PaymentSession {
  provider: PaymentProviderId;
  sessionId: string;
  clientSecret?: string;
  publishableKey?: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntentSnapshot {
  providerPaymentId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  authorizedAt?: string | null;
  capturedAt?: string | null;
  failureReason?: string | null;
}

export interface ReleaseRequest {
  transactionId: string;
  amountCents: number;
  currency: string;
  providerPaymentId: string;
}

export interface RefundRequest {
  transactionId: string;
  amountCents?: number;
  currency: string;
  providerPaymentId: string;
  reason?: string;
}

export interface WebhookVerificationResult {
  ok: boolean;
  eventType?: string;
  providerPaymentId?: string;
  paymentStatus?: PaymentStatus;
  raw?: unknown;
  error?: string;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;

  /** Create a checkout / client session for the buyer. */
  createSession(input: {
    transactionId: string;
    amountCents: number;
    currency: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentSession>;

  /** Begin or confirm payment (provider-specific). */
  initiatePayment(input: {
    sessionId: string;
    transactionId: string;
  }): Promise<PaymentIntentSnapshot>;

  getStatus(providerPaymentId: string): Promise<PaymentIntentSnapshot>;

  /** Capture authorized funds (manual capture — not escrow). */
  requestRelease(input: ReleaseRequest): Promise<PaymentIntentSnapshot>;

  requestRefund(input: RefundRequest): Promise<PaymentIntentSnapshot>;

  verifyWebhook(payload: string | Buffer, signature: string): Promise<WebhookVerificationResult>;
}
