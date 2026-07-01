-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED_REFUND', 'RESOLVED_RELEASE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DisputeClaim" AS ENUM ('NOT_AS_DESCRIBED', 'DELIVERY', 'WEIGHT_VARIANCE', 'GENETICS_QUALITY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sellerVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "filedById" TEXT NOT NULL,
    "claim" "DisputeClaim" NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "detail" TEXT NOT NULL,
    "evidence" TEXT[],
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "rateeId" TEXT NOT NULL,
    "lotId" TEXT,
    "role" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "Rating_rateeId_idx" ON "Rating"("rateeId");

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

