# Brindle

Self-serve, mobile-first livestock auction platform. Breeders and producers run
their own timed-online and live-ring sales; buyers get one credit approval and
bid across every sale. Genetics (semen/embryo) lots are first-class, not an
afterthought.

## Why this, not a Superior clone

Superior Livestock owns commodity load-lot feeder cattle through a 40-year field-rep
network that no software replaces. White-label tools (Webtron, Big Sky, WeAuction,
Showman) and sale-barn back offices (ViewTrak, U.S. Livestock Systems) cover the
plumbing. The lane still open: genetics as a native auction format with EPDs,
inline USDA comparable-sale context at the bid box, and a buyer-side marketplace
with one credit approval across sellers (the white-label tools deliberately silo
bidders per auctioneer).

## Stack

TypeScript · pnpm + Turbo monorepo · Next.js · Fastify · Prisma · Postgres · Redis ·
Mux/IVS (live video) · Stripe Connect (integrated-payment lots) · Railway.

## Layout

```
apps/
  web/        Next.js — buyer marketplace + bidding (:3000)
  console/    Next.js — seller console + auctioneer/clerk ring control (:3002)
  api/        Fastify — REST + WS gateway + bidding sequencer (:3001)
packages/
  core/       money (integer cents) + cwt/head/dose math   [LOCKED INVARIANTS]
  auction/    sequencer, proxy bids, anti-snipe soft close
  settlement/ forward contracts + Stripe adapters
  market-data/USDA AMS ingest + futures basis
  db/         Prisma schema + client
  ui/         shared components, design tokens
infra/railway/
```

## Locked invariants

- Money is integer cents (`bigint`). No floats touch money. Ever.
- One authoritative sequencer per auction room. No distributed bid arbitration.
- FIFO price-time priority; ties go to the resting bid. Atomic state transitions.
- All cattle pricing math lives in `@brindle/core`, nowhere else.
- Immutable bid log — every bid/accept/reject/clock event is append-only (dispute record).

## Settlement modes (chosen by lot type, not checkout)

- **CONTRACT** — load lots / breeding stock: forward contract, pay on delivery.
  Brindle charges a tech fee and never custodies proceeds. Keeps us out of
  Packers & Stockyards market-agency status.
- **INTEGRATED_PAYMENT** — genetics / small lots: Stripe Connect facilitator.

## Local dev

```bash
pnpm install
cp .env.example .env            # fill in secrets
pnpm db:generate
pnpm db:migrate                 # needs a running Postgres
pnpm dev                        # turbo runs api + web + console
```

## Roadmap

1. Timed-online genetics (beachhead; cleanest legal shape, most underserved format)
2. Live ring engine (port Crossbar matcher) + Mux video + contract settlement
3. Buyer marketplace + USDA comparable-sale context inline
4. Scale + trust hardening (disputes, 10x load test, SLA/failover)

## Legal

CONTRACT mode = SaaS/tech provider (no proceeds custody). INTEGRATED_PAYMENT =
marketplace facilitator. Confirm P&S Act posture + state licensing with an ag
attorney before the first contract-mode sale. Not legal advice.
