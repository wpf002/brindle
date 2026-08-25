-- AlterTable
ALTER TABLE "Auction" ADD COLUMN     "brandInspectionCentsPerHead" BIGINT,
ADD COLUMN     "commissionBps" INTEGER,
ADD COLUMN     "commissionCentsPerHead" BIGINT,
ADD COLUMN     "yardageCentsPerHead" BIGINT;
