/**
 * Which deployment this process is.
 *
 * Several subsystems have a real implementation and a dev fallback chosen by
 * whether a key is configured: payments, identity verification, email, error
 * reporting. Each of those used to guard itself with `NODE_ENV === "production"`,
 * which leaves a real hole: a staging box is a real deployment with real people
 * on it, but `NODE_ENV` is routinely not "production" there. On such a box the
 * identity fallback self-approves every user, the payment fallback "settles"
 * money that never moves, and nothing says a word.
 *
 * So the gate is explicit and separate from NODE_ENV. Dev fallbacks are allowed
 * only when BRINDLE_ENV is "development" (or unset, which is what a laptop
 * looks like). Anything else — staging, preview, production — must have real
 * keys or the process refuses to boot.
 */
export type DeployEnv = "development" | "staging" | "production";

export function deployEnv(): DeployEnv {
  const raw = (process.env.BRINDLE_ENV ?? process.env.NODE_ENV ?? "development").toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  if (raw === "staging" || raw === "preview" || raw === "test") return "staging";
  return "development";
}

/** True only on a developer's machine, where stubs are the point. */
export function isLocalDev(): boolean {
  return deployEnv() === "development";
}

/**
 * Whether this deployment settles money through the platform at all.
 *
 * A marketplace can legitimately run without it: `CONTRACT` lots hammer to a
 * forward contract and the buyer and seller settle between themselves, which is
 * how most sale barns have always worked. Integrated payment is the addition,
 * not the baseline.
 *
 * This is deliberately *not* the same as the missing-key fallback. A stubbed
 * gateway pretends to move money that never moves; turning payments off says
 * the feature is unavailable and refuses the request. Silence about it is the
 * dangerous option, so anything payment-shaped returns a clear error and the
 * seller console stops asking people to connect a payout account.
 */
export function paymentsEnabled(): boolean {
  return (process.env.PAYMENTS_ENABLED ?? "true").toLowerCase() !== "false";
}

/**
 * Whether this deployment verifies government ID at all.
 *
 * Every provider worth using here is paid, and identity verification only earns
 * its cost once strangers are moving real money between themselves. A
 * marketplace that isn't settling payments yet doesn't need it, and paying for
 * it to sit idle is worse than not having it.
 *
 * Off means the badge is never offered — not that it's granted for free. The
 * dev stub self-approves everyone, which is fine on a laptop and dishonest
 * anywhere else; that distinction is the whole point of this flag existing
 * separately from a missing key.
 */
export function identityVerificationEnabled(): boolean {
  return (process.env.IDENTITY_VERIFICATION_ENABLED ?? "true").toLowerCase() !== "false";
}

/**
 * Whether this deployment can send email.
 *
 * In-app notifications are unaffected — they're database rows and always get
 * written. What's lost is anything that has to reach someone who isn't looking
 * at the site: email confirmation, and password reset, which becomes
 * unrecoverable rather than merely inconvenient. Those endpoints say so plainly
 * instead of returning a cheerful "sent" for mail that goes nowhere.
 *
 * Fine for a deployment with no real users on it. Turn it on before there are.
 */
export function emailEnabled(): boolean {
  return (process.env.EMAIL_ENABLED ?? "true").toLowerCase() !== "false";
}

// Recorded so boot can log exactly which stubs are live, and /ready can report
// them — an operator should never have to guess whether identity checks on this
// box are real.
const activeFallbacks = new Set<string>();

/**
 * Register a dev fallback, refusing to start if this isn't a local dev box.
 *
 * @param subsystem short name, e.g. "identity"
 * @param requiredVars the env vars that would have selected the real adapter
 */
export function useDevFallback(subsystem: string, requiredVars: string[]): void {
  if (!isLocalDev()) {
    throw new Error(
      `${subsystem}: refusing to use the development stub on a ${deployEnv()} deployment. ` +
        `Set ${requiredVars.join(" and ")}, or set BRINDLE_ENV=development if this really is a local machine.`,
    );
  }
  activeFallbacks.add(subsystem);
}

/** Subsystems currently running on a stub, for the boot banner and /ready. */
export function activeDevFallbacks(): string[] {
  return [...activeFallbacks].sort();
}
