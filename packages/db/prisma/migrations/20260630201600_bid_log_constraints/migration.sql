-- AlterTable
ALTER TABLE "Bid" ADD COLUMN     "streamId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Bid_lotId_seq_key" ON "Bid"("lotId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_lotId_streamId_key" ON "Bid"("lotId", "streamId");

