# Railway deployment

Brindle runs as three Railway services in one project. The two managed plugins
back the engine's durability guarantees; the single Next app and the API each
deploy from this monorepo with their own root and a `railway.json`.

## Services

| Service    | Source            | Root dir       | Notes |
|------------|-------------------|----------------|-------|
| `postgres` | managed plugin    | —              | Provides `DATABASE_URL`. Enable PITR backups (G4). |
| `redis`    | managed plugin    | —              | Live auction state, the per-room bid stream, locks. Provides `REDIS_URL`. |
| `api`      | `apps/api`        | repo root      | Fastify. Healthcheck `/health`. Public WS + REST. |
| `web`      | `apps/web`        | repo root      | Next.js — one app: marketplace, bidding, seller console, and live ring. |

Each app service builds from the **repo root** (not the app subdir) so pnpm can
resolve workspace packages; the per-app `railway.json` filters the build to the
one app. Set the root directory to `/` in each service's settings.

**Also set each service's config file path**, or the `railway.json` is silently
ignored — Railway only looks for it at the service's root directory, which is
`/` here, so `apps/web/railway.json` is never found. The symptom is a build that
fails with "No start command detected" while the config sits right there in the
repo. Set it in the service's Settings, or from the CLI:

```sh
MUT='mutation($envId: String!, $svcId: String!, $input: ServiceInstanceUpdateInput!) {
  serviceInstanceUpdate(environmentId: $envId, serviceId: $svcId, input: $input) }'

railway api "$MUT" --var "envId=$ENV_ID" --var "svcId=$WEB_SERVICE_ID" \
  --variables '{"input":{"railwayConfigFile":"apps/web/railway.json"}}'

railway api "$MUT" --var "envId=$ENV_ID" --var "svcId=$API_SERVICE_ID" \
  --variables '{"input":{"railwayConfigFile":"apps/api/railway.json"}}'
```

Get the IDs from `railway status --json`.

## Environment variables

Copy from [`.env.example`](../../.env.example). Per service:

- **api** — `NODE_ENV=production`, `BRINDLE_ENV=production`, `JWT_SECRET` (real
  secret, not the placeholder), `DATABASE_URL` and `REDIS_URL` (reference the
  plugin vars), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PERSONA_API_KEY`,
  `PERSONA_TEMPLATE_ID`, `PERSONA_WEBHOOK_SECRET`, `RESEND_API_KEY`,
  `S3_*` (+ `S3_ENDPOINT` if using R2), `CORS_ORIGINS` and `WEB_BASE_URL` set to
  the web service's public URL.
- **web** — `NEXT_PUBLIC_API_URL` pointing at the `api` service's public URL, and
  `NEXT_PUBLIC_SITE_URL` at its own.
- Reference plugin vars with Railway's `${{Postgres.DATABASE_URL}}` /
  `${{Redis.REDIS_URL}}` syntax rather than copying literals.

**The API will not boot without the real keys.** With `BRINDLE_ENV` set to
anything but `development`, missing Stripe, Persona, or Resend credentials is a
startup failure naming the variable, not a silent fallback to stubs — a staging
box is a real deployment, and self-approving identity checks or a fake payment
gateway there would be worse than not starting. `JWT_SECRET` likewise must be a
real value, not `change-me-in-prod`.

## Migrations

Migrations are not run at container start (avoids races across replicas). Run them
as a one-off against the production database when deploying schema changes:

`railway run` injects the *internal* `DATABASE_URL` (`postgres.railway.internal`),
which is unreachable from a laptop — it only resolves inside Railway's private
network. Open a tunnel first:

```sh
railway connect Postgres --tunnel-only --port 55432 &

eval "$(railway variables --service Postgres --kv \
  | grep -E '^(PGUSER|PGPASSWORD|PGDATABASE)=' | sed 's/^/export /')"
export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@localhost:55432/${PGDATABASE}"

pnpm --filter @brindle/db exec prisma migrate deploy
```

`migrate deploy` applies committed migrations only — it never generates or prompts.

## First administrator

No admin exists on a fresh deployment, and there is no bootstrap endpoint. Register
an account through the web app, then grant it OWNER over the same tunnel:

```sh
pnpm --filter @brindle/api admin:grant you@ranch.com OWNER
```

## The sequencer

The bid sequencer currently runs in-process in `api`. When concurrency grows
(Phase 4), split it into its own service consuming `auction:{id}:bids` from Redis;
the room-to-consumer mapping stays 1:1 so the price-time invariant is preserved.
