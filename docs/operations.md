# Operations runbook

Everything needed to run Brindle in production, plus the things that are
deliberately not done yet.

## Services

| Service | What it is | Notes |
|---|---|---|
| `api` | Fastify + WebSocket (`apps/api`) | Stateless except the in-process lot-close sweep — see below |
| `web` | Next.js (`apps/web`) | Server-renders catalog/lot/market pages |
| Postgres | Durable state, immutable bid log | The system of record |
| Redis | Bid/ring ingest streams, sequencer cursors, pub/sub | Not a cache — losing it loses in-flight bids |

## Health checks

- `GET /health` — liveness. No dependencies, so a database blip won't cause an
  orchestrator to kill a healthy process.
- `GET /ready` — readiness. Checks Postgres and Redis; returns `503` when either
  is unreachable. **Point your load balancer at `/ready`, not `/health`.**

## Required production configuration

The API refuses to boot without these, by design — a silent fallback would mean
fake payments or unverified identities in production:

- `JWT_SECRET` — must not be the placeholder
- `STRIPE_SECRET_KEY` — otherwise settlement uses an in-memory fake gateway
- `PERSONA_API_KEY` + `PERSONA_TEMPLATE_ID` — otherwise identity self-approves

Also set: `ADMIN_API_TOKEN`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`,
`WEB_BASE_URL`. See `.env.example` for the full list.

## Deploying

Migrations are **not** run at container start — that races across replicas. Run
them as a one-off before rolling out new application code:

```bash
railway run --service api pnpm --filter @brindle/db exec prisma migrate deploy
```

`migrate deploy` only applies committed migrations; it never generates or prompts.

## Known scaling limit: the lot-close sweep

`closeExpiredLots` runs on an interval **inside each API process**. With more
than one API instance, every instance sweeps. The close itself is safe — the
status update is idempotent and the sequencer's `forceClose` is a no-op on a
cold cache — but each instance will independently fire close notifications,
so buyers could get duplicates.

**Before scaling past one API instance**, do one of:
- move the sweep to a dedicated single-instance worker, or
- gate it behind a Redis lock (`SET key NX PX`), or
- drive it from an external scheduler hitting `POST /admin/lots/close-expired`.

The same applies to any future scheduled work.

## Backups

Not configured by this repo — it must be enabled on the managed database:

1. **Enable point-in-time recovery** on the Postgres instance. The bid log is
   the dispute record; losing it is unrecoverable in a way that losing a cache
   is not.
2. **Verify a restore actually works** before launch. An untested backup is a
   hypothesis, not a backup.
3. Redis holds in-flight bid streams. Enable AOF persistence if your provider
   offers it — a Redis loss mid-sale drops bids that haven't been drained to
   Postgres yet.

## Market data

USDA AMS LMPR ("DataMart") is free and needs no API key. Pull the latest
reports:

```bash
curl -X POST "$API/admin/market/sync" \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"days":3}'
```

Idempotent on the report natural key, so it's safe to run on a schedule (daily
is plenty — these reports publish once per business day).

Note this is packer-reported **fed cattle** pricing, not sale-barn feeder-calf
averages. Feeder-cattle auction reports live in the separate MyMarketNews API,
which requires a free registered key (`AMS_MMN_API_KEY`).

## Load testing

```bash
pnpm --filter @brindle/api loadtest 10 30   # 10 buyers, 30 bids each
```

Asserts the sequencer's integrity invariants under real concurrency: contiguous
unique sequence numbers (no lost or duplicated bids) and a correct final winner.
Run it against a staging database, never production.

## Incident checklist

1. Check `/ready` on each instance to find which dependency is down.
2. Check API logs — every 5xx is captured through the error handler with the URL,
   method, and user id.
3. If the sequencer is stuck, remember Redis stream state is durable: restarting
   the API resumes from the persisted cursor and replays anything undrained.
4. The bid log in Postgres is authoritative. Lot state is *reconstructed* from it
   on load, so a corrupted in-memory state is fixed by a restart — the bid log
   itself is append-only and never rewritten.

## Not done yet

- No automated backup verification
- No alerting (errors are captured; nothing pages anyone)
- No multi-region or failover story
- Sweep is single-instance-only (above)
- No independent security review — see `docs/security.md`
