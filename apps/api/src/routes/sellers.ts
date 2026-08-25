import type { FastifyInstance } from "fastify";
import { prisma, LotStatus, UserType } from "@brindle/db";

// The consignor directory: who is selling into open sales right now.
//
// This used to carry a breeder "story" layer — bio, pull-quote, founding year,
// ranch operations with acreage and herd size. That belonged to the
// breeder-marketplace framing. A sale barn has consignors, not a brand, and a
// buyer scanning a sale wants to know what else a consignor has in the ring,
// not read their history.
export async function sellerRoutes(app: FastifyInstance) {
  app.get("/sellers", async () => {
    const sellers = await prisma.user.findMany({
      where: {
        type: {
          in: [UserType.SELLER_BREEDER, UserType.GENETICS_PROVIDER, UserType.SALE_MANAGER, UserType.RANCHER],
        },
        auctions: { some: { lots: { some: { status: LotStatus.ACTIVE } } } },
      },
      select: {
        id: true, businessName: true, legalName: true, state: true, sellerVerified: true,
      },
      orderBy: { businessName: "asc" },
    });
    return { sellers };
  });
}
