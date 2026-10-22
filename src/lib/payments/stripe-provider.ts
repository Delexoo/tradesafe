import Stripe from 'stripe';

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
 * Stripe PaymentIntents with `capture_method: 'manual'`.
 *
 * This places a card authorization hold when supported — it is **not** licensed escrow
 * and holds expire per Stripe/network rules (~7 days for many cards unless extended).
 * Capture/cancel must be driven by server-side state + verified webhooks.
 */
export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe' as const;

  private stripe: Stripe | null = null;

  private getStripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        'STRIPE_SECRET_KEY is not configured. Set PAYMENT_PROVIDER=demo or provide Stripe keys.',
      );
    }
    if (!this.stripe) {
      this.stripe = new Stripe(key);
    }
    return this.stripe;
  }

  private mapStatus(intent: Stripe.PaymentIntent): PaymentStatus {
    switch (intent.status) {
      case 'requires_payment_method':
      case 'requires_confirmation':
        return 'initiated';
      case 'requires_capture':
        return 'authorized';
      case 'processing':
        return 'pending';
      case 'succeeded':
        return intent.capture_method === 'manual' && !intent.latest_charge
          ? 'authorized'
          : 'captured';
      case 'canceled':
        return 'cancelled';
      default:
        return 'pending';
    }
  }

  private snapshot(intent: Stripe.PaymentIntent): PaymentIntentSnapshot {
    return {
      providerPaymentId: intent.id,
      status: this.mapStatus(intent),
      amountCents: intent.amount,
      currency: intent.currency,
      authorizedAt:
        intent.status === 'requires_capture' || intent.status === 'succeeded'
          ? new Date(intent.created * 1000).toISOString()
          : null,
      capturedAt:
        intent.status === 'succeeded' ? new Date().toISOString() : null,
      failureReason:
        intent.last_payment_error?.message ?? intent.cancellation_reason ?? null,
    };
  }

  async createSession(input: {
    transactionId: string;
    amountCents: number;
    currency: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentSession> {
    const stripe = this.getStripe();
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      throw new Error(
        'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured for Stripe checkout.',
      );
    }

    const intent = await stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: input.currency,
      capture_method: 'manual',
      metadata: {
        transaction_id: input.transactionId,
        ...input.metadata,
      },
      automatic_payment_methods: { enabled: true },
    });

    return {
      provider: 'stripe',
      sessionId: intent.id,
      clientSecret: intent.client_secret ?? undefined,
      publishableKey,
    };
  }

  async initiatePayment(input: {
    sessionId: string;
    transactionId: string;
  }): Promise<PaymentIntentSnapshot> {
    const stripe = this.getStripe();
    const intent = await stripe.paymentIntents.retrieve(input.sessionId);
    return this.snapshot(intent);
  }

  async getStatus(providerPaymentId: string): Promise<PaymentIntentSnapshot> {
    const stripe = this.getStripe();
    const intent = await stripe.paymentIntents.retrieve(providerPaymentId);
    return this.snapshot(intent);
  }

  async requestRelease(input: ReleaseRequest): Promise<PaymentIntentSnapshot> {
    const stripe = this.getStripe();
    const intent = await stripe.paymentIntents.capture(input.providerPaymentId, {
      amount_to_capture: input.amountCents,
    });
    return this.snapshot(intent);
  }

  async requestRefund(input: RefundRequest): Promise<PaymentIntentSnapshot> {
    const stripe = this.getStripe();
    await stripe.refunds.create({
      payment_intent: input.providerPaymentId,
      amount: input.amountCents,
      reason: input.reason ? 'requested_by_customer' : undefined,
    });
    const intent = await stripe.paymentIntents.retrieve(input.providerPaymentId);
    const snapshot = this.snapshot(intent);
    return { ...snapshot, status: 'refunded' };
  }

  async verifyWebhook(
    payload: string | Buffer,
    signature: string,
  ): Promise<WebhookVerificationResult> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return {
        ok: false,
        error:
          'STRIPE_WEBHOOK_SECRET is not configured; cannot verify Stripe webhooks.',
      };
    }

    try {
      const stripe = this.getStripe();
      const event = stripe.webhooks.constructEvent(payload, signature, secret);
      let providerPaymentId: string | undefined;
      let paymentStatus: PaymentStatus | undefined;

      if (event.type.startsWith('payment_intent.')) {
        const intent = event.data.object as Stripe.PaymentIntent;
        providerPaymentId = intent.id;
        paymentStatus = this.mapStatus(intent);
      }

      return {
        ok: true,
        eventType: event.type,
        providerPaymentId,
        paymentStatus,
        raw: event,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook verification failed';
      return { ok: false, error: message };
    }
  }
}
