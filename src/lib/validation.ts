import { z } from 'zod';
import { CATEGORIES, PARTICIPANT_ROLES } from './types';

export const createTradeSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().default(''),
  category: z.enum(CATEGORIES).optional().default('other'),
  amount_cents: z.number().int().positive(),
  currency: z.string().length(3).optional().default('usd'),
  delivery_method: z.string().max(100).optional().default('other'),
  creator_role: z.enum(['buyer', 'seller']),
  terms: z.record(z.unknown()).optional().default({}),
  draft: z.boolean().optional().default(false),
  notes: z.string().max(2000).optional(),
});

export const tradeActionSchema = z.object({
  action: z.enum([
    'initiate_payment',
    'mark_preparing',
    'submit_tracking',
    'confirm_delivery',
    'request_cancel',
    'open_dispute',
    'demo_authorize_payment',
    'demo_capture',
  ]),
  payload: z.record(z.unknown()).optional().default({}),
});

export const messageSchema = z.object({
  body: z.string().min(1).max(4000),
});

export const joinInviteSchema = z.object({
  token: z.string().min(16),
});

export const createInviteSchema = z.object({
  transactionId: z.string().uuid(),
  role: z.enum(['buyer', 'seller', 'observer']),
});

export const openDisputeSchema = z.object({
  transactionId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  details: z.string().max(5000).optional().default(''),
});

export const profilePatchSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().url().nullable().optional(),
  notification_prefs: z.record(z.unknown()).optional(),
  privacy_prefs: z.record(z.unknown()).optional(),
});

export const notificationsPatchSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  mark_all: z.boolean().optional(),
});

export const paymentCreateSchema = z.object({
  transactionId: z.string().uuid(),
});

export const submitTrackingSchema = z.object({
  tracking_carrier: z.string().max(100).optional(),
  tracking_number: z.string().max(200).optional(),
  tracking_url: z.string().url().optional(),
});

export type CreateTradeInput = z.infer<typeof createTradeSchema>;
export type TradeActionInput = z.infer<typeof tradeActionSchema>;
