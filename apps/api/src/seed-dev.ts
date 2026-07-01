// Dev seed: a genetics seller and an approved buyer so dev-login works locally.
// Run: pnpm --filter @brindle/api exec tsx src/seed-dev.ts
import { prisma, UserType, CreditStatus } from "@brindle/db";

async function main() {
  const seller = await prisma.user.upsert({
    where: { email: "seller@ranch.com" },
    update: {},
    create: {
      email: "seller@ranch.com",
      type: UserType.SELLER_BREEDER,
      legalName: "Willow Creek Genetics",
      businessName: "Willow Creek Genetics",
      state: "MT",
      stripeAccountId: "acct_dev_seller",
    },
  });
  const buyer = await prisma.user.upsert({
    where: { email: "buyer@ranch.com" },
    update: { creditStatus: CreditStatus.APPROVED },
    create: {
      email: "buyer@ranch.com",
      type: UserType.BUYER,
      legalName: "Rocking R Ranch",
      businessName: "Rocking R Ranch",
      state: "NE",
      creditStatus: CreditStatus.APPROVED,
      buyerNumber: "B-000001",
      creditLimitCents: 5_000_000n,
    },
  });
  console.log("seeded seller:", seller.email, "buyer:", buyer.email);
  await prisma.$disconnect();
}

void main();
