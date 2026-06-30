# Railway deployment

Brindle runs as five Railway services in one project. The two managed plugins
back the engine's durability guarantees; the three app services each deploy from
this monorepo with their own root and a `railway.json`.

## Services

| Service    | Source            | Root dir       | Notes |
|------------|-------------------|----------------|-------|
| `postgres` | managed plugin    | —              | Provides `DATABASE_URL`. Enable PITR backups (G4). |
| `redis`    | managed plugin    | —              | Live auction state, the per-room bid stream, locks. Provides `REDIS_URL`. |
| `api`      | `apps/api`        | repo root      | Fastify. Healthcheck `/health`. Public WS + REST. |
| `web`      | `apps/web`        | repo root      | Next.js buyer marketplace (port from `$PORT`). |
| `console`  | `apps/console`    | repo root      | Next.js seller console. |

Each app service builds from the **repo root** (not the app subdir) so pnpm can
resolve workspace packages; the per-app `railway.json` filters the build to the
one app. Set the root directory to `/` in each service's settings.

## Environment variables

Copy from [`.env.example`](../../.env.example). Per service:

- **api** — `NODE_ENV=production`, `JWT_SECRET` (real secret, not the placeholder),
  `DATABASE_URL` and `REDIS_URL` (reference the plugin vars), `STRIPE_*`,
  `PERSONA_API_KEY`, `S3_*` (+ `S3_ENDPOINT` if using R2).
- **web / console** — `NEXT_PUBLIC_API_URL` pointing at the `api` service's public URL.
- Reference plugin vars with Railway's `${{Postgres.DATABASE_URL}}` /
  `${{Redis.REDIS_URL}}` syntax rather than copying literals.

`JWT_SECRET` **must** be a real value in production — the API throws on boot if it
is unset or left as `change-me-in-prod`.

## Migrations

Migrations are not run at container start (avoids races across replicas). Run them
as a one-off against the production database when deploying schema changes:

```sh
railway run --service api pnpm --filter @brindle/db exec prisma migrate deploy
```

`migrate deploy` applies committed migrations only — it never generates or prompts.

## The sequencer

The bid sequencer currently runs in-process in `api`. When concurrency grows
(Phase 4), split it into its own service consuming `auction:{id}:bids` from Redis;
the room-to-consumer mapping stays 1:1 so the price-time invariant is preserved.
