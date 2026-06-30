-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('RANCHER', 'FEEDLOT', 'ORDER_BUYER', 'SELLER_BREEDER', 'GENETICS_PROVIDER', 'SALE_MANAGER', 'BUYER');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AuctionFormat" AS ENUM ('LIVE_RING', 'TIMED_ONLINE');

-- CreateEnum
CREATE TYPE "SettlementMode" AS ENUM ('CONTRACT', 'INTEGRATED_PAYMENT');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LotCategory" AS ENUM ('STEERS', 'HEIFERS', 'COWS', 'BULLS', 'PAIRS', 'BRED_HEIFERS', 'CALVES', 'SEMEN', 'EMBRYO');

-- CreateEnum
CREATE TYPE "PriceUnit" AS ENUM ('CWT', 'HEAD', 'DOSE', 'EMBRYO');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SOLD', 'PASSED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "BidKind" AS ENUM ('MANUAL', 'PROXY', 'FLOOR', 'PHONE');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('ACTIVE', 'OUTBID', 'WINNING', 'RETRACTED', 'INVALID');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SIGNED', 'DELIVERED', 'SETTLED', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'HELD', 'CAPTURED', 'REFUNDED', 'DISPUTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "type" "UserType" NOT NULL,
    "legalName" TEXT NOT NULL,
    "businessName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "state" TEXT,
    "buyerNumber" TEXT,
    "creditStatus" "CreditStatus" NOT NULL DEFAULT 'PENDING',
    "creditLimitCents" BIGINT,
    "stripeAccountId" TEXT,
    "idVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" "AuctionFormat" NOT NULL,
    "settlementMode" "SettlementMode" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "streamUrl" TEXT,
    "status" "AuctionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "buyerPremiumBps" INTEGER NOT NULL DEFAULT 0,
    "softCloseSecs" INTEGER NOT NULL DEFAULT 120,
    "termsText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "lotNumber" INTEGER NOT NULL,
    "category" "LotCategory" NOT NULL,
    "headCount" INTEGER,
    "primaryBreed" TEXT,
    "breedComposition" JSONB,
    "avgWeightLbs" DECIMAL(8,2),
    "baseWeightLbs" DECIMAL(8,2),
    "shrinkPct" DECIMAL(5,2),
    "slideCents" INTEGER,
    "bodyCondition" DECIMAL(3,1),
    "pregStatus" TEXT,
    "programCerts" TEXT[],
    "originState" TEXT,
    "eidTags" TEXT[],
    "bullName" TEXT,
    "bullRegId" TEXT,
    "epd" JSONB,
    "dosesAvailable" INTEGER,
    "postThawMotility" DECIMAL(5,2),
    "storageFacility" TEXT,
    "diseaseTests" JSONB,
    "priceUnit" "PriceUnit" NOT NULL,
    "startingBidCents" BIGINT NOT NULL,
    "reserveCents" BIGINT,
    "status" "LotStatus" NOT NULL DEFAULT 'DRAFT',
    "photos" TEXT[],
    "videoUrl" TEXT,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "priceUnit" "PriceUnit" NOT NULL,
    "kind" "BidKind" NOT NULL DEFAULT 'MANUAL',
    "proxyMaxCents" BIGINT,
    "seq" BIGINT NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'ACTIVE',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "hammerCents" BIGINT NOT NULL,
    "buyerPremiumCents" BIGINT NOT NULL,
    "platformFeeCents" BIGINT NOT NULL,
    "baseWeightLbs" DECIMAL(8,2) NOT NULL,
    "slideCents" INTEGER NOT NULL,
    "shrinkPct" DECIMAL(5,2) NOT NULL,
    "deliveryWindow" JSONB NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "signedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "platformFeeCents" BIGINT NOT NULL,
    "stripePaymentId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_buyerNumber_key" ON "User"("buyerNumber");

-- CreateIndex
CREATE INDEX "Auction_status_startsAt_idx" ON "Auction"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_auctionId_lotNumber_key" ON "Lot"("auctionId", "lotNumber");

-- CreateIndex
CREATE INDEX "Bid_lotId_seq_idx" ON "Bid"("lotId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_lotId_key" ON "Contract"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_lotId_key" ON "Payment"("lotId");

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
