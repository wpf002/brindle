#!/usr/bin/env bash
# One-shot local setup. Assumes pnpm + Node 20 + a reachable Postgres/Redis.
set -euo pipefail
echo "→ brindle setup"
corepack enable || true
pnpm install
[ -f .env ] || cp .env.example .env
pnpm db:generate
echo "→ done. edit .env, ensure Postgres is up, then: pnpm db:migrate && pnpm dev"
