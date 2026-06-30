# Railway services

- `api`      — Fastify (apps/api). Needs DATABASE_URL, REDIS_URL.
- `web`      — Next.js (apps/web).
- `console`  — Next.js (apps/console).
- `postgres` — managed plugin.
- `redis`    — managed plugin (live auction state, bid streams, locks).

Set env from `.env.example`. The sequencer worker can run inside `api` or as a
separate service reading the Redis stream — split it out once concurrency grows.
