-- CreateEnum
CREATE TYPE "BuyOrderStatus" AS ENUM ('OPEN', 'FILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConsignmentStatus" AS ENUM ('SUBMITTED', 'CHECKED_IN', 'TAGGED', 'SORTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Lot" ADD COLUMN     "consignmentId" TEXT;

-- CreateTable
CREATE TABLE "BuyOrder" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "category" "LotCategory" NOT NULL,
    "minWeightLbs" INTEGER,
    "maxWeightLbs" INTEGER,
    "targetHead" INTEGER NOT NULL,
    "maxPriceCents" BIGINT NOT NULL,
    "region" TEXT,
    "notes" TEXT,
    "status" "BuyOrderStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyOrderFill" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "headCount" INTEGER NOT NULL,
    "priceCents" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyOrderFill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consignment" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "consignorId" TEXT NOT NULL,
    "headCount" INTEGER NOT NULL,
    "category" "LotCategory" NOT NULL,
    "estWeightLbs" INTEGER,
    "primaryBreed" TEXT,
    "story" TEXT,
    "programCerts" TEXT[],
    "originState" TEXT,
    "payeeName" TEXT,
    "payeeAddress" TEXT,
    "backTagRange" TEXT,
    "brandInspected" BOOLEAN NOT NULL DEFAULT false,
    "cviOnFile" BOOLEAN NOT NULL DEFAULT false,
    "status" "ConsignmentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuyOrder_buyerId_status_idx" ON "BuyOrder"("buyerId", "status");

-- CreateIndex
CREATE INDEX "BuyOrderFill_lotId_idx" ON "BuyOrderFill"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyOrderFill_orderId_lotId_key" ON "BuyOrderFill"("orderId", "lotId");

-- CreateIndex
CREATE INDEX "Consignment_auctionId_status_idx" ON "Consignment"("auctionId", "status");

-- CreateIndex
CREATE INDEX "Consignment_consignorId_idx" ON "Consignment"("consignorId");

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_consignmentId_fkey" FOREIGN KEY ("consignmentId") REFERENCES "Consignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyOrder" ADD CONSTRAINT "BuyOrder_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyOrderFill" ADD CONSTRAINT "BuyOrderFill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "BuyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyOrderFill" ADD CONSTRAINT "BuyOrderFill_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consignment" ADD CONSTRAINT "Consignment_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consignment" ADD CONSTRAINT "Consignment_consignorId_fkey" FOREIGN KEY ("consignorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
