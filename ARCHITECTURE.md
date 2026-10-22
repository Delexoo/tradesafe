# TradeSafe Architecture

## Product

TradeSafe is a private, link-based live transaction coordination platform. Users create temporary trade rooms, invite participants via secure links, track dual progress (buyer payment / seller fulfillment), chat, dispute, and complete deals. It is **not** a public marketplace.

## Stack

| Layer | Choice |
|-------|--------|
| Site | **Vanilla HTML/CSS/JS** under `site/` (visible page-by-page on GitHub) |
| Server | `server.mjs` — static files + `/api/*` JSON (Supabase service role server-side only) |
| Design | Hooxie-adapted Manrope light system (`site/css/app.css`) |
| Database / Auth | Supabase (PostgreSQL, Auth, RLS); browser uses anon key via `/api/config` |
| Payments | **Demo** (default) + optional Stripe manual-capture holds |
| Hosting | Node `server.mjs` locally; static `site/` (+ API) on Vercel or similar |
| Shared logic / tests | `src/lib` + Vitest (legacy Next app under `src/app` is not the primary UI) |

### Design system (Hooxie)

- **Font:** Manrope
- **App canvas:** `#eceef2` with white surface panels (`border-radius: 20px`, soft shadow)
- **Primary:** `#3b82f6` · buttons `min-height: 40px`, `border-radius: 12px`, weight 650
- **Fields:** inset `1px` line, `12px` radius, focus ring primary
- **Marketing landing:** warm cream `#f4f2ee` / ink `#1c1b19`
- Buyer progress = blue; seller fulfillment = purple — always paired with text labels

## Pages (`site/`)

| URL | File |
|-----|------|
| `/` | `index.html` |
| `/login.html`, `/signup.html` | Auth |
| `/dashboard.html` | Trade list |
| `/create.html` | Create wizard |
| `/room.html?id=` | Live room |
| `/join.html?token=` or `/join/:token` | Accept invite |
| `/history.html`, `/settings.html` | History / settings |

## Important payment reality

**Stripe does not provide licensed escrow.** TradeSafe uses:

1. **Demo provider** — fully simulated, clearly labeled, never touches real money.
2. **Stripe PaymentIntents with `capture_method: manual`** — authorization hold only; not licensed escrow.

The UI never claims money is “secured by TradeSafe.”

## Data isolation

This Supabase project also hosts Moonrise Studio. TradeSafe tables use the `ts_` prefix and do not mutate Moonrise tables.

## Transaction lifecycle (state machine)

```
draft → awaiting_acceptance → awaiting_payment → payment_pending
  → funds_authorized → awaiting_fulfillment → in_fulfillment
  → awaiting_confirmation → completion_pending → completed

Branches: cancellation_requested → cancelled
          refund_pending → refunded
          disputed → (resume or cancelled/refunded)
          suspended | expired
```

Privileged financial transitions occur **only** from verified provider webhooks or the demo server adapter — never from the client.

## Dual progress

- **Buyer progress**: payment milestones + terms acceptance.
- **Seller progress**: fulfillment milestones.
- Bars reflect workflow state, not safety guarantees. Verification sources: `user_reported` | `awaiting_verification` | `provider_confirmed` | `system`.

## Security boundaries

- Invitation tokens stored hashed; raw token only in the share URL once.
- RLS: participants see only their transactions; chat/evidence scoped to participants.
- Service role used only in `server.mjs` / webhook handlers.
- Clients cannot set payment verification or release status.
- Demo mode gated by server env `DEMO_MODE=true`.

## Outstanding external dependencies

- Supabase project (configured)
- Stripe account + webhook endpoint (optional for live holds)
- Email provider (optional)
- Licensed escrow partner (if true escrow is required later)
