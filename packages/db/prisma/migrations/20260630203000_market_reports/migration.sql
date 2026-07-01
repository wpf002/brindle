-- CreateTable
CREATE TABLE "MarketReport" (
    "id" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "region" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "wtLowLbs" INTEGER NOT NULL,
    "wtHighLbs" INTEGER NOT NULL,
    "avgCentsPerCwt" INTEGER NOT NULL,
    "headCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketReport_category_wtLowLbs_wtHighLbs_reportDate_idx" ON "MarketReport"("category", "wtLowLbs", "wtHighLbs", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "MarketReport_source_category_wtLowLbs_wtHighLbs_reportDate_key" ON "MarketReport"("source", "category", "wtLowLbs", "wtHighLbs", "reportDate");

