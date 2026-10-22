import { describe, expect, it } from 'vitest';

import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
} from '../state-machine';

describe('state-machine', () => {
  it('allows happy-path client transitions', () => {
    expect(
      canTransition('draft', 'awaiting_acceptance', {
        source: 'client',
        action: 'publish',
        actorRole: 'creator',
      }),
    ).toBe(true);

    expect(
      canTransition('awaiting_acceptance', 'awaiting_payment', {
        source: 'client',
        action: 'accept_terms',
        actorRole: 'buyer',
      }),
    ).toBe(true);
  });

  it('blocks privileged financial transitions from client source', () => {
    expect(
      canTransition('payment_pending', 'funds_authorized', {
        source: 'client',
        action: 'payment_authorized',
        actorRole: 'creator',
      }),
    ).toBe(false);

    expect(
      canTransition('payment_pending', 'funds_authorized', {
        source: 'provider',
        action: 'payment_authorized',
        actorRole: 'creator',
      }),
    ).toBe(true);

    expect(
      canTransition('completion_pending', 'completed', {
        source: 'demo_server',
      }),
    ).toBe(true);

    expect(
      canTransition('refund_pending', 'refunded', {
        source: 'system',
      }),
    ).toBe(true);
  });

  it('assertTransition throws InvalidTransitionError with context', () => {
    expect(() =>
      assertTransition('payment_pending', 'funds_authorized', {
        source: 'client',
      }),
    ).toThrow(InvalidTransitionError);
  });

  it('rejects disallowed edges', () => {
    expect(canTransition('draft', 'completed', { source: 'system' })).toBe(
      false,
    );
  });
});
