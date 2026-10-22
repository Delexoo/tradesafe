import { DemoPaymentProvider } from './demo-provider';
import { StripeProvider } from './stripe-provider';
import type { PaymentProvider, PaymentProviderId } from './types';

let demoSingleton: DemoPaymentProvider | null = null;
let stripeSingleton: StripeProvider | null = null;

function resolveProviderId(): PaymentProviderId {
  const raw = process.env.PAYMENT_PROVIDER?.toLowerCase();
  if (raw === 'stripe') {
    return 'stripe';
  }
  return 'demo';
}

/** Server-only demo flag (`DEMO_MODE=true`). Never enable via client query params. */
export function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE === 'true';
}

/**
 * Server-side provider selection from `PAYMENT_PROVIDER` (demo | stripe).
 * Defaults to demo. Never derive this from client query parameters.
 */
export function getPaymentProvider(): PaymentProvider {
  const id = resolveProviderId();
  if (id === 'stripe') {
    stripeSingleton ??= new StripeProvider();
    return stripeSingleton;
  }
  demoSingleton ??= new DemoPaymentProvider();
  return demoSingleton;
}

export type { PaymentProvider, PaymentProviderId } from './types';
export { DemoPaymentProvider } from './demo-provider';
export { StripeProvider } from './stripe-provider';
