// Grant or revoke administrator access.
//
// There is deliberately no bootstrap endpoint and no shared admin token — the
// only way to create the first OWNER is to run this on a machine that already
// has database credentials. Everything after that can be done from the admin
// console by an existing OWNER, and every change there is written to the audit
// log.
//
//   pnpm --filter @brindle/api admin:grant you@ranch.com OWNER
//   pnpm --filter @brindle/api admin:grant them@ranch.com SUPPORT
//   pnpm --filter @brindle/api admin:grant them@ranch.com none
//   pnpm --filter @brindle/api admin:grant --list
import { prisma, AdminRole } from "@brindle/db";

const ROLES = Object.values(AdminRole) as string[];

function usage(): never {
  console.error(
    "usage: admin:grant <email> <SUPPORT|OPERATOR|OWNER|none>\n" +
      "       admin:grant --list\n\n" +
      "  SUPPORT   read-only: buyer list, stats, audit log\n" +
      "  OPERATOR  acts on the marketplace: suspend buyers, resolve disputes, sync market data\n" +
      "  OWNER     everything, including granting and revoking admin access",
  );
  process.exit(1);
}

async function list(): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { adminRole: { not: null } },
    select: { email: true, legalName: true, adminRole: true },
    orderBy: { email: "asc" },
  });
  if (admins.length === 0) {
    console.log("No administrators yet. Grant the first one:\n  admin:grant you@ranch.com OWNER");
    return;
  }
  for (const a of admins) console.log(`${a.adminRole!.padEnd(9)} ${a.email}  (${a.legalName})`);
}

async function main(): Promise<void> {
  const [emailArg, roleArg] = process.argv.slice(2);
  if (!emailArg) usage();
  if (emailArg === "--list") return list();
  if (!roleArg) usage();

  const email = emailArg.trim().toLowerCase();
  const revoking = roleArg.toLowerCase() === "none";
  const role = roleArg.toUpperCase();
  if (!revoking && !ROLES.includes(role)) usage();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account for ${email}. They need to register first.`);
    process.exit(1);
  }

  // Refuse to remove the last OWNER — the same guard the admin console has.
  // Without it a single mistyped command locks everyone out of the console.
  if (user.adminRole === AdminRole.OWNER && role !== AdminRole.OWNER) {
    const owners = await prisma.user.count({ where: { adminRole: AdminRole.OWNER } });
    if (owners <= 1) {
      console.error(`${email} is the only OWNER. Grant OWNER to someone else first.`);
      process.exit(1);
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { adminRole: revoking ? null : (role as AdminRole) },
  });

  console.log(revoking ? `Revoked admin access for ${email}.` : `${email} is now ${role}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
