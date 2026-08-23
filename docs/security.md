# Security posture

A self-review of the auth, payment, and bidding surfaces. **This is not an
independent security audit** — it's the developer's own accounting of what was
built, what was deliberately hardened, and what a real reviewer should attack
first. Get an outside review before real money moves.

## What's in place

### Authentication
- Passwords hashed with scrypt (`node:crypto`), 16-byte random salt per user,
  constant-time comparison. No native dependency.
- Login returns an identical error for "no such user" and "wrong password", so
  the endpoint can't be used to enumerate registered emails.
- Login and registration are rate-limited to 10 attempts per 10 minutes per IP.
- Sessions are HS256 JWTs, 12-hour expiry, no refresh tokens.
- `/auth/dev-login` (passwordless, auto-provisioning) returns 404 when
  `NODE_ENV=production`.

### Authorization
- Every seller mutation re-checks ownership server-side against the session —
  auctions, lots, operations, catalog imports, delivery.
- Delivery details are visible only to that lot's seller and winning bidder.
- Admin operations (credit approval, suspension, market sync, stats, news
  authoring) sit behind a shared `ADMIN_API_TOKEN` header, entirely separate
  from user sessions. The token is compared in constant time (both sides hashed
  to a fixed width first, so neither the value nor its length leaks).
- **Credit approval is read live from the database at WebSocket connect time**,
  not from the JWT claim. A 12-hour-old token cannot bid on stale approval, and
  a suspension takes effect immediately.

### Bidding integrity
- One authoritative sequencer per auction room; all bids funnel through a Redis
  stream in append order. Resolution is single-threaded per room.
- Bids are an append-only log with a unique `(lotId, seq)` constraint. Prices are
  *reconstructed* by replaying that log, so state can't silently drift.
- Idempotent on `(lotId, streamId)` — a redelivered stream entry can't double-post.
- The client cannot set `bidderId`, `sellerId`, or `creditApproved`; the gateway
  stamps all three from the session and the database.
- Verified under concurrency: `pnpm --filter @brindle/api loadtest` asserts
  contiguous, unique sequence numbers and a correct winner.

### Money
- All money is integer cents (`bigint`). No float ever touches a price.
- Brindle never holds seller proceeds — Stripe destination charges pay the
  seller's connected account directly, with Brindle taking an application fee.
- Payment holds are idempotent per lot, so a retried hammer can't double-charge.
- Production boot fails without a real Stripe key rather than silently
  "settling" through the in-memory fake gateway.

### Transport and headers
- `@fastify/helmet` (HSTS, `X-Content-Type-Options`, `X-Frame-Options`).
- CORS restricted to configured origins.
- Global 300 req/min rate limit, with tighter per-route limits on auth.
- 5xx responses return `INTERNAL_ERROR` only — no internal messages or stack
  traces reach a client.

### Webhooks
- The Persona identity webhook verifies an HMAC signature with
  `timingSafeEqual` and refuses to process when `PERSONA_WEBHOOK_SECRET` is
  unset. It never trusts an unsigned payload.

## Known weaknesses — attack these first

1. **JWTs cannot be revoked.** Signing out only drops the client's copy. A stolen
   token is valid for up to 12 hours. Credit changes are mitigated (checked live),
   but account takeover is not. *Fix: a server-side session/deny list.*
2. **Tokens live in `localStorage`**, so any XSS is a token theft. There is no
   CSP on the web app yet. *Fix: httpOnly cookies + CSP.*
3. **No email verification.** `emailVerifiedAt` exists in the schema but nothing
   sets it; anyone can register with an address they don't control.
4. **`ADMIN_API_TOKEN` is a single shared secret** — no per-admin identity, no
   audit trail of which human approved a credit line, no rotation story.
5. **No 2FA** anywhere, including on admin operations that move money.
6. **Stripe webhooks are not consumed.** Onboarding status is polled instead. A
   Connect account disabled *after* onboarding won't be noticed until the next
   poll.
7. **No account lockout** beyond IP rate limiting — a distributed attacker can
   spread login attempts across IPs.
8. **No content scanning on uploads.** Size is capped (15 MB images / 500 MB
   video / 25 MB PDF, with `ContentLength` signed into the presigned URL so the
   storage provider enforces it), and content-type is allowlisted — but nothing
   inspects the actual bytes for malware or verifies the file matches its
   declared type.
9. **The dev identity provider self-approves.** It's disabled in production, but
   any staging environment missing the Persona keys silently has fake identity
   verification.

## For a reviewer

Highest-value targets, in order:
1. The WebSocket bid path (`apps/api/src/routes/bids.ts` → sequencer) — can a
   client forge a bid as another user, or replay one?
2. Settlement (`packages/settlement`, `apps/api/src/routes/settlement.ts`) — can
   a lot be captured twice, or refunded beyond its captured amount?
3. Seller-ownership checks — is there any mutation missing its ownership guard?
4. The admin surface — is `ADMIN_API_TOKEN` compared safely, and is any admin
   route reachable with a plain user session?
