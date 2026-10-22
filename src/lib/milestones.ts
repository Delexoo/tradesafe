import type { Category, Milestone, VerificationSource } from './types';

export type DeliveryMethod =
  | 'shipping'
  | 'pickup'
  | 'digital_transfer'
  | 'in_person'
  | 'other';

interface MilestoneTemplate {
  key: string;
  track: Milestone['track'];
  label: string;
  verification_source: VerificationSource;
  sort_order: number;
}

function template(
  items: MilestoneTemplate[],
): Omit<Milestone, 'status'>[] {
  return items.map((item) => ({
    key: item.key,
    track: item.track,
    label: item.label,
    verification_source: item.verification_source,
    sort_order: item.sort_order,
    status: 'pending' as const,
  }));
}

const SHARED_JOIN: MilestoneTemplate = {
  key: 'shared_parties_ready',
  track: 'shared',
  label: 'Both parties joined',
  verification_source: 'system',
  sort_order: 0,
};

const BUYER_TERMS: MilestoneTemplate = {
  key: 'buyer_terms_accepted',
  track: 'buyer',
  label: 'Buyer accepted terms',
  verification_source: 'system',
  sort_order: 10,
};

const SELLER_TERMS: MilestoneTemplate = {
  key: 'seller_terms_accepted',
  track: 'seller',
  label: 'Seller accepted terms',
  verification_source: 'system',
  sort_order: 10,
};

const BUYER_PAYMENT_INIT: MilestoneTemplate = {
  key: 'buyer_payment_initiated',
  track: 'buyer',
  label: 'Payment started',
  verification_source: 'provider_confirmed',
  sort_order: 20,
};

const BUYER_PAYMENT_AUTH: MilestoneTemplate = {
  key: 'buyer_payment_authorized',
  track: 'buyer',
  label: 'Payment authorization on file',
  verification_source: 'provider_confirmed',
  sort_order: 30,
};

const BUYER_CONFIRM: MilestoneTemplate = {
  key: 'buyer_receipt_confirmed',
  track: 'buyer',
  label: 'Buyer confirmed receipt',
  verification_source: 'user_reported',
  sort_order: 40,
};

const SELLER_ACK: MilestoneTemplate = {
  key: 'seller_fulfillment_acknowledged',
  track: 'seller',
  label: 'Seller acknowledged order',
  verification_source: 'user_reported',
  sort_order: 20,
};

const SELLER_DELIVER: MilestoneTemplate = {
  key: 'seller_delivery_complete',
  track: 'seller',
  label: 'Delivery / transfer complete',
  verification_source: 'awaiting_verification',
  sort_order: 30,
};

const SHARED_COMPLETE: MilestoneTemplate = {
  key: 'shared_trade_completed',
  track: 'shared',
  label: 'Trade marked complete',
  verification_source: 'provider_confirmed',
  sort_order: 50,
};

function physicalDeliverySteps(method: DeliveryMethod): MilestoneTemplate[] {
  if (method === 'pickup' || method === 'in_person') {
    return [
      {
        key: 'seller_ready_for_pickup',
        track: 'seller',
        label: 'Ready for pickup',
        verification_source: 'user_reported',
        sort_order: 25,
      },
      {
        ...SELLER_DELIVER,
        label: 'Handed off to buyer',
        verification_source: 'user_reported',
      },
    ];
  }
  return [
    {
      key: 'seller_shipped',
      track: 'seller',
      label: 'Shipped',
      verification_source: 'user_reported',
      sort_order: 25,
    },
    {
      ...SELLER_DELIVER,
      label: 'Delivery confirmed',
    },
  ];
}

/**
 * Default milestone definitions for a category and delivery method.
 * Returned rows omit DB ids; callers persist via `ts_milestones`.
 */
export function defaultMilestonesForCategory(
  category: Category,
  deliveryMethod: string = 'other',
): Omit<Milestone, 'status'>[] {
  const method = (deliveryMethod || 'other') as DeliveryMethod;

  switch (category) {
    case 'digital':
    case 'website_domain':
      return template([
        SHARED_JOIN,
        BUYER_TERMS,
        SELLER_TERMS,
        BUYER_PAYMENT_INIT,
        BUYER_PAYMENT_AUTH,
        SELLER_ACK,
        {
          key: 'seller_digital_transfer',
          track: 'seller',
          label: 'Digital asset transferred',
          verification_source: 'awaiting_verification',
          sort_order: 30,
        },
        BUYER_CONFIRM,
        SHARED_COMPLETE,
      ]);
    case 'service':
      return template([
        SHARED_JOIN,
        BUYER_TERMS,
        SELLER_TERMS,
        BUYER_PAYMENT_INIT,
        BUYER_PAYMENT_AUTH,
        {
          key: 'seller_service_started',
          track: 'seller',
          label: 'Service work started',
          verification_source: 'user_reported',
          sort_order: 25,
        },
        {
          key: 'seller_service_delivered',
          track: 'seller',
          label: 'Service delivered',
          verification_source: 'awaiting_verification',
          sort_order: 30,
        },
        BUYER_CONFIRM,
        SHARED_COMPLETE,
      ]);
    case 'physical':
    case 'electronics':
    case 'collectibles':
      return template([
        SHARED_JOIN,
        BUYER_TERMS,
        SELLER_TERMS,
        BUYER_PAYMENT_INIT,
        BUYER_PAYMENT_AUTH,
        ...physicalDeliverySteps(method),
        BUYER_CONFIRM,
        SHARED_COMPLETE,
      ]);
    case 'other':
    default:
      return template([
        SHARED_JOIN,
        BUYER_TERMS,
        SELLER_TERMS,
        BUYER_PAYMENT_INIT,
        BUYER_PAYMENT_AUTH,
        SELLER_ACK,
        ...physicalDeliverySteps(method),
        BUYER_CONFIRM,
        SHARED_COMPLETE,
      ]);
  }
}
