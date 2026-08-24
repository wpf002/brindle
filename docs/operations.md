# Operations runbook

Everything needed to run Brindle in production, plus the things that are
deliberately not done yet.

## Services

| Service | What it is | Notes |
|---|---|---|
| `api` | Fastify + WebSocket (`apps/api`) | Stateless; scheduled work is Redis-lock-guarded, so replicas are safe |
| `web` | Next.js (`apps/web`) | Server-renders catalog/lot/market pages |
| Postgres | Durable state, immutable bid log | The system of record |
| Redis | Bid/ring ingest streams, sequencer cursors, pub/sub | Not a cache — losing it loses in-flight bids |

## Health checks

- `GET /health` — liveness. No dependencies, so a database blip won't cause an
  orchestrator to kill a healthy process.
- `GET /ready` — readiness. Checks Postgres and Redis; returns `503` when either
  is unreachable. **Point your load balancer at `/ready`, not `/health`.**

## Required production configuration

Set `BRINDLE_ENV` to `staging` or `production` on every real deployment. It is
deliberately separate from `NODE_ENV`, which is routinely not `"production"` on a
staging box even though staging is a real deployment with real people on it.
Anything other than `development` makes these mandatory — the API refuses to boot
without them rather than silently falling back to a stub:

- `JWT_SECRET` — must not be the placeholder
- `STRIPE_SECRET_KEY` — otherwise settlement uses an in-memory fake gateway
- `PERSONA_API_KEY` + `PERSONA_TEMPLATE_ID` — otherwise identity self-approves
- `RESEND_API_KEY` — otherwise password-reset and verification links go to stdout

The boot failure names the missing variable. `/ready` reports the environment and
any stub in use, so you can confirm from outside the process.

Also set: `STRIPE_WEBHOOK_SECRET`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`,
`WEB_BASE_URL`. See `.env.example` for the full list. There is no admin token —
see **Administrator access** below.

## Administrator access

Admin rights are a per-user role, not a shared secret:

| Role | Can |
|---|---|
| `SUPPORT` | Read: buyer list, stats, audit log |
| `OPERATOR` | Act: approve credit, suspend buyers, resolve disputes, sync market data |
| `OWNER` | Everything, including granting and revoking admin access |

There is no bootstrap endpoint. The first OWNER is granted from a machine that
already has database credentials:

```bash
pnpm --filter @brindle/api admin:grant you@ranch.com OWNER
pnpm --filter @brindle/api admin:grant --list
```

After that, use the admin console — every change there lands in the audit log
with the actor, target, and IP. Removing the last OWNER is refused by both the
console and the CLI.

## Stripe webhooks

Point a Stripe webhook endpoint at `POST /webhooks/stripe` and set
`STRIPE_WEBHOOK_SECRET` to its signing secret. Subscribe to at least:

- `account.updated` — a Connect account disabled *after* onboarding. Without
  this, a seller whose payouts were paused looks fine until someone refreshes.
- `payment_intent.succeeded`, `payment_intent.payment_failed`
- `charge.refunded`, `charge.dispute.created`

The route verifies the signature against the raw body and returns 500 on a
handler error so Stripe retries rather than dropping the event. With no signing
secret configured it returns 503 — it never processes an unsigned payload.

## Deploying

Migrations are **not** run at container start — that races across replicas. Run
them as a one-off before rolling out new application code:

```bash
railway run --service api pnpm --filter @brindle/db exec prisma migrate deploy
```

`migrate deploy` only applies committed migrations; it never generates or prompts.

## Scheduled work

Two intervals run inside the API process:

- **lot-close sweep** (`LOT_CLOSE_SWEEP_MS`, default 30s) — a timed lot whose
  clock runs out with no further bids needs someone to notice. Soft-close
  extension lives in the pure resolver; this is what catches plain expiry.
- **session prune** (hourly) — deletes session rows a week past expiry.
- **market sync** (`MARKET_SYNC_MS`, default 6h) — pulls the day's USDA prices
  and writes them up as a Market Report post. Every 6 hours rather than daily
  because AMS publishes once per business day but not at a fixed hour; both
  halves are idempotent, so extra runs rewrite rather than duplicate. Set
  `MARKET_SYNC_MS=0` to turn it off and drive it externally instead.

Both take a Redis lease first (`withLock`, `SET key NX PX` with a
compare-and-delete release), so exactly one instance runs each per tick. Replicas
are safe: without the lease every instance would fire its own duplicate close
notifications to the same buyers and sellers.

`POST /admin/lots/close-expired` (OPERATOR) runs the same sweep on demand if you
would rather drive it from an external scheduler.

## Backups

```bash
pnpm --filter @brindle/api backup                  # dump, then verify the restore
pnpm --filter @brindle/api backup -- --no-verify   # dump only
pnpm --filter @brindle/api backup -- --verify-only path/to.dump
```

The verification is the point: it restores the dump into a throwaway database,
compares row counts on `User`, `Auction`, `Lot`, `Bid`, `Payment`, `Dispute`, and
`AuditLog` against the source, drops the scratch database, and **deletes the dump
if it doesn't check out**. A dump that can't be restored is worse than no dump,
because it looks like protection. Needs `pg_dump`/`pg_restore`/`psql` on PATH;
writes to `BACKUP_DIR` (default `./backups`).

Still the host's job, and not configured by this repo:

1. **Point-in-time recovery** on the managed Postgres instance. The bid log is
   the dispute record; losing it is unrecoverable in a way that losing a cache
   is not.
2. **Off-site retention.** A dump on the same disk as the database protects
   against nothing. Ship it somewhere else, encrypted, on a schedule.
3. Redis holds in-flight bid streams. Enable AOF persistence if your provider
   offers it — a Redis loss mid-sale drops bids that haven't been drained to
   Postgres yet.

## Market data

USDA AMS LMPR ("DataMart") is free and needs no API key. Pull the latest
reports:

```bash
curl -X POST "$API/admin/market/sync" \
  -b "brindle_session=$SESSION_COOKIE" \
  -H 'content-type: application/json' \
  -d '{"days":3}'
```

Requires an `OPERATOR` session; the sync is written to the audit log.

Idempotent on the report natural key, so it's safe to run on a schedule. The API
already does this every 6 hours on its own (see **Scheduled work**); the endpoint
is for forcing a pull or backfilling history.

The sync also publishes a Market Report news post for each date it touched. Pass
`{"publish": false}` when backfilling months of price history, or the news feed
fills with retrospective daily reports. To re-run only the write-ups — after
changing the generator, or for a day whose rows landed late:

```bash
curl -X POST "$API/admin/market/publish" \
  -b "brindle_session=$SESSION_COOKIE" \
  -H 'content-type: application/json' \
  -d '{"days":3}'
```

Posts are slugged `market-report-YYYY-MM-DD`, so a re-run rewrites that day
rather than publishing a second copy — which is what makes a late USDA revision
correct the existing post.

Two things the generator gets right that are easy to get wrong, and that the
tests in `packages/market-data/src/report.test.ts` lock down:

- **Live and dressed prices are never blended.** Live is per hundredweight on
  the hoof (~$225), dressed is per hundredweight of hanging carcass (~$355), and
  they describe the same cattle. Averaging them yields a number that means
  nothing, and the gap between them is the dressing percentage, not news.
- **"All Beef Type" rows are roll-ups, not another class.** They already contain
  the steer, heifer, and mixed rows for the same quote. Summing everything
  double-counts every animal.

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

- No alerting (errors are captured; nothing pages anyone)
- No off-site backup retention — the verification runs, the shipping doesn't
- No multi-region or failover story
- No malware scanning on uploads (file signatures are verified; contents aren't)
- No independent security review — see `docs/security.md`
- No legal review of the terms, privacy policy, or Packers and Stockyards posture
