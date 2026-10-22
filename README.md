# TradeSafe

Private, link-based live transaction rooms. **Browser website only** — open a URL, no installers.

## Source you can read on GitHub

The live UI is plain files under [`site/`](./site/):

| Page | File |
|------|------|
| Landing | `site/index.html` |
| Log in / Sign up | `site/login.html`, `site/signup.html` |
| Dashboard | `site/dashboard.html` |
| Create trade | `site/create.html` |
| Live room | `site/room.html?id=…` |
| Join invite | `site/join.html?token=…` |
| History / Settings | `site/history.html`, `site/settings.html` |
| Styles | `site/css/app.css` (Hooxie-adapted) |
| Client JS | `site/js/*.js` |

`server.mjs` serves those files and the `/api/*` JSON backend (Supabase service role stays on the server).

Design language is adapted from Hooxie (`dash.css` / `site.css`): Manrope, light gray canvas, white panels, blue primary `#3b82f6`.

**Payments:** Demo mode is simulated and labeled. Stripe (optional) is an authorization hold — not licensed escrow.

## Local

```bash
npm install
npm run dev
```

Open http://localhost:3000

Env (see `.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DEMO_MODE=true`, `PAYMENT_PROVIDER=demo`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` / `npm start` | Serve vanilla site + API |
| `npm run notes` | Render `brain/releases.json` from `brain/log.json` |
| `npm test` | Unit tests for shared logic under `src/lib` |

## Brain / commits

Agent memory lives in `.cursor/rules/` and `brain/log.json`. Asking to **commit** or **update** bumps the version, updates the brain log, and commits.
