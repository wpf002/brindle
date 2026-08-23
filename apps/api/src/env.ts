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
