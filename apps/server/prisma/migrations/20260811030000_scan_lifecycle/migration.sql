ALTER TABLE "LibraryScan" ADD COLUMN "heartbeatAt" DATETIME;
ALTER TABLE "LibraryScan" ADD COLUMN "interruptionReason" TEXT;
ALTER TABLE "DriveScanSource" ADD COLUMN "lastScanInterruptionReason" TEXT;

CREATE INDEX "LibraryScan_status_heartbeatAt_idx"
ON "LibraryScan"("status", "heartbeatAt");
