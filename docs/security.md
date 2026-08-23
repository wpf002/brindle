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
  the endpoint can't be used to enumerate registered emails. `/auth/forgot-password`
  answers `{sent: true}` either way, for the same reason.
- **Sessions are server-side rows and revocable.** The JWT carries only a session
  id; every request looks the session up, so signing out, suspending an account,
  or changing a password takes effect on the next request rather than whenever
  the token happens to expire. `/auth/sessions` lists a user's live sessions and
  `/auth/logout-all` revokes them all.
- **Session state is read live from the database on every request** — credit
  status, admin role, email verification, 2FA. No security decision is ever made
  from a stale token claim.
- The session token is in an **httpOnly, `SameSite=Lax`, secure-in-production
  cookie**. Page JS cannot read it, so an XSS bug can't lift a session and replay
  it somewhere else. The WebSocket handshake authenticates by the same cookie —
  no token in a URL, where it would land in proxy logs.
- **Per-account lockout**: 8 failed passwords locks the account for 15 minutes
  (423 `ACCOUNT_LOCKED`) and notifies the owner. This is the layer that matters
  against an attacker spreading guesses across many IPs.
- Login is additionally rate-limited to 20 attempts per 10 minutes keyed on
  **IP *and* the email being attempted**, so a sale barn or ranch office behind
  one address doesn't lock the whole room out over one person's typos.
- **Email verification**: registration issues a single-use, 24-hour, hashed
  token; only its SHA-256 lives in the database.
- **Password reset**: single-use, 60-minute hashed token. A reset or a password
  change revokes every existing session.
- **TOTP two-factor** (RFC 6238, implemented in `apps/api/src/totp.ts` with no
  dependency, verified against all six of the RFC's published test vectors so it
  interoperates with real authenticator apps). Enrollment only completes once the
  user proves they can generate a code. One recovery code, hashed with the same
  scrypt path as passwords, shown exactly once; using it is single-use and
  disables 2FA so the user isn't locked out of an account they just proved they
  own.
- `/auth/dev-login` (passwordless, auto-provisioning) returns 404 outside
  development.

### Authorization
- Every seller mutation re-checks ownership server-side against the session —
  auctions, lots, operations, catalog imports, delivery.
- Delivery details are visible only to that lot's seller and winning bidder.
- **Admin access is a per-user role**, not a shared secret: `SUPPORT` (read-only),
  `OPERATOR` (acts on the marketplace), `OWNER` (also grants and revokes access).
  Routes declare a minimum rank. The first OWNER is granted from a machine with
  database credentials (`pnpm --filter @brindle/api admin:grant …`) — there is no
  bootstrap endpoint.
- **Every admin action writes an audit row** (actor, action, target, detail, IP),
  readable at `/admin/audit`. "Which human approved this credit line" now has an
  answer.
- Demoting or removing the last `OWNER` is refused, in the console and in the CLI
  — otherwise one mistyped command locks everyone out.
- Credit approval and suspension take effect immediately, because session state
  is read live (above).

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
- **Stripe webhooks are consumed** (`POST /webhooks/stripe`), signature-verified
  against the raw request body. `account.updated` catches a Connect account
  *disabled after* onboarding — previously invisible until someone refreshed —
  and `payment_intent.*`, `charge.refunded`, and `charge.dispute.created` keep
  payment status honest when things happen outside our own request flow.

### Deployment safety
- Several subsystems have a real implementation and a dev stub: payments,
  identity verification, email, error reporting. **The stubs refuse to run
  anywhere but a local machine.** The gate is `BRINDLE_ENV`, deliberately
  separate from `NODE_ENV`: a staging box is a real deployment with real people
  on it, and `NODE_ENV` is routinely not `"production"` there. Boot fails with a
  message naming the missing keys rather than silently self-approving identity
  checks or "settling" money that never moves.
- `/ready` reports the deployment environment and any stub in use, so an operator
  never has to guess whether identity checks on a box are real.

### Transport and headers
- API: `@fastify/helmet` (HSTS, `X-Content-Type-Options`, `X-Frame-Options`).
- Web: **nonce-based CSP** via `apps/web/src/middleware.ts` — `strict-dynamic`
  script policy, `frame-ancestors 'none'`, `object-src 'none'`, plus
  `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, and a
  `Permissions-Policy` that turns off camera, microphone, geolocation, and the
  payment API.
- CORS restricted to configured origins, with credentials enabled so the session
  cookie rides along.
- Global 300 req/min rate limit, with tighter per-route limits on auth.
- 5xx responses return `INTERNAL_ERROR` only — no internal messages or stack
  traces reach a client.

### Uploads
- Presigned direct-to-storage PUTs: bytes never pass through the API. Size is
  capped per type (15 MB images / 500 MB video / 25 MB PDF) with `ContentLength`
  signed into the URL, so the storage provider enforces it.
- **Content is verified after upload.** A presigned URL signs the *declared*
  content type, not the bytes — nothing stops someone declaring `image/jpeg` and
  PUTting an HTML page that then gets served from our bucket under a type the
  browser trusts. `POST /media/confirm` reads the first 32 bytes back with a
  ranged GET, checks the file signature against an allowlist (JPEG, PNG, WebP,
  ISO-BMFF video, PDF), and **deletes the object** on a mismatch. A key that
  hasn't passed this is not attachable to a lot.

### Webhooks
- The Persona identity webhook verifies an HMAC signature with `timingSafeEqual`
  and refuses to process when `PERSONA_WEBHOOK_SECRET` is unset. It never trusts
  an unsigned payload.
- The Stripe webhook verifies against the raw body (the route opts out of JSON
  parsing so the signed bytes are intact) and returns 401 on an invalid
  signature, 503 when no signing secret is configured.

### Backups
- `pnpm --filter @brindle/api backup` dumps, then **restores the dump into a
  throwaway database and compares row counts** on the tables whose loss would end
  the business. A dump that fails verification is deleted rather than left
  looking like protection.

## Known weaknesses — attack these first

1. **No malware scanning on uploads.** File signatures are verified and
   mismatches are deleted (above), but a genuine JPEG carrying an exploit
   payload passes. *Fix: a scanning step before the object is publicly readable.*
2. **The audit log is append-only by convention, not by constraint.** Anyone with
   database access can edit it. *Fix: ship it to write-once external storage.*
3. **Recovery is one code, not a set.** Using it disables 2FA. That's a
   deliberate trade against lockout, but it means one leaked code is one clean
   2FA bypass for anyone who also has the password.
4. **No CSRF tokens.** The session cookie is `SameSite=Lax`, which stops
   cross-site POSTs, and the API requires `application/json` — but a
   same-registrable-domain subdomain takeover would defeat both. *Fix: an
   origin check on mutating routes.*
5. **Session cookie is `SameSite=Lax`, not `Strict`**, because the API and web
   app are separate origins on one registrable domain. That's what makes the
   WebSocket handshake work; it's also a weaker posture than `Strict`.
6. **Backups are verified but not off-site.** The script proves a dump restores;
   where it's stored, how long it's kept, and whether it's encrypted at rest are
   the host's job and are not yet configured.
7. **No independent security review**, and no penetration test.
8. **No legal review** of the terms, privacy policy, or the Packers and
   Stockyards posture. That one genuinely can't be closed in code.

## For a reviewer

Highest-value targets, in order:
1. The WebSocket bid path (`apps/api/src/routes/bids.ts` → sequencer) — can a
   client forge a bid as another user, or replay one?
2. Settlement (`packages/settlement`, `apps/api/src/routes/settlement.ts`) — can
   a lot be captured twice, or refunded beyond its captured amount?
3. Session resolution (`apps/api/src/auth.ts`) — is there any path where a
   revoked or expired session still resolves, or where a role is read from the
   token rather than the database?
4. Seller-ownership checks — is there any mutation missing its ownership guard?
5. The admin surface — is any `/admin/*` route reachable below its declared rank,
   and does every mutation write an audit row?
