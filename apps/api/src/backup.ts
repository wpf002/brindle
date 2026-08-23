// Database backup, with restore verification.
//
// An unverified backup isn't a backup — it's a file you hope is a backup. So
// this does both halves: takes a dump, then restores it into a throwaway
// database and compares row counts against the source. If the restore doesn't
// come back with the same data, the script fails loudly rather than leaving a
// green checkmark on a broken file.
//
//   pnpm --filter @brindle/api backup                 # dump + verify
//   pnpm --filter @brindle/api backup -- --no-verify  # dump only (faster)
//   pnpm --filter @brindle/api backup -- --verify-only <file>
//
// Requires the Postgres client tools (pg_dump, pg_restore, psql) on PATH.
// Retention and off-site copies are the host's job — a dump sitting on the same
// disk as the database protects against exactly nothing.
import { spawn } from "node:child_process";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@brindle/db";

// The tables whose loss would actually end the business. Row counts on these
// are what the verification compares — a restore that silently dropped the bid
// log would otherwise look fine.
const CRITICAL_TABLES = ["User", "Auction", "Lot", "Bid", "Payment", "Dispute", "AuditLog"] as const;

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) =>
      reject(new Error(`${cmd} could not be run (${e.message}). Are the Postgres client tools installed?`)));
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim() || out.trim()}`)));
  });
}

function databaseUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  return new URL(raw);
}

/** A sibling database on the same server, used as the restore target. */
function scratchUrl(source: URL, name: string): URL {
  const u = new URL(source.toString());
  u.pathname = `/${name}`;
  return u;
}

async function dump(outPath: string): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  const url = databaseUrl();
  // Custom format: compressed, and pg_restore can rebuild indexes in parallel.
  await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", outPath, url.toString()]);
  const { size } = await stat(outPath);
  if (size === 0) throw new Error("pg_dump produced an empty file");
  console.log(`dump  ${outPath}  ${(size / 1024 / 1024).toFixed(1)} MB`);
}

async function sourceCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of CRITICAL_TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) FROM "${table}"`);
    counts[table] = Number(rows[0]!.count);
  }
  return counts;
}

async function verify(dumpPath: string, expected: Record<string, number>): Promise<void> {
  const source = databaseUrl();
  // A timestamped name so a failed run can never collide with a live database.
  const scratchName = `brindle_verify_${Date.now()}`;
  const admin = scratchUrl(source, "postgres");
  const scratch = scratchUrl(source, scratchName);

  console.log(`verify  restoring into ${scratchName}`);
  await run("psql", [admin.toString(), "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE "${scratchName}"`]);

  try {
    await run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--dbname", scratch.toString(), dumpPath]);

    const problems: string[] = [];
    for (const table of CRITICAL_TABLES) {
      const out = await run("psql", [scratch.toString(), "-tAc", `SELECT count(*) FROM "${table}"`]);
      const restored = Number(out.trim());
      const want = expected[table]!;
      // At-least, not exactly: counts are read before pg_dump opens its
      // snapshot, so a bid placed in between legitimately shows up in the
      // restore and not in `want`. Fewer rows than we saw is the real failure —
      // that means the dump lost data that existed when it started.
      const ok = restored >= want;
      console.log(`  ${table.padEnd(10)} ${String(want).padStart(8)} → ${String(restored).padStart(8)}  ${ok ? "ok" : "MISSING ROWS"}`);
      if (!ok) problems.push(`${table}: had ${want} rows, restore has only ${restored}`);
    }

    if (problems.length > 0) {
      throw new Error(`restore verification failed:\n  ${problems.join("\n  ")}`);
    }
    console.log("verify  restore matches the source");
  } finally {
    // Always drop the scratch database, even when verification failed —
    // otherwise a nightly job accumulates one dead database per run.
    await run("psql", [admin.toString(), "-c", `DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`])
      .catch((e) => console.error(`warning: could not drop ${scratchName}: ${e.message}`));
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dir = process.env.BACKUP_DIR ?? "./backups";

  if (args[0] === "--verify-only") {
    const file = args[1];
    if (!file) throw new Error("--verify-only needs a dump file path");
    await verify(file, await sourceCounts());
    return;
  }

  // Timestamp in the filename, UTC, sortable.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(dir, `brindle-${stamp}.dump`);

  // Read before the dump, so any row that existed at this moment must survive
  // into the restore. See verify() for why the comparison is at-least.
  const expected = await sourceCounts();
  await dump(outPath);

  if (args.includes("--no-verify")) {
    console.log("verify  skipped (--no-verify)");
    return;
  }

  try {
    await verify(outPath, expected);
  } catch (e) {
    // A dump that can't be restored is worse than no dump, because it looks
    // like protection. Remove it so nobody relies on it later.
    await unlink(outPath).catch(() => undefined);
    throw e;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
