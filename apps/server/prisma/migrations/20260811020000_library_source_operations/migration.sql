PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

ALTER TABLE "DriveScanSource" ADD COLUMN "folderName" TEXT;
ALTER TABLE "DriveScanSource" ADD COLUMN "folderPath" TEXT;
ALTER TABLE "DriveScanSource" ADD COLUMN "driveName" TEXT;
ALTER TABLE "DriveScanSource" ADD COLUMN "ownerName" TEXT;
ALTER TABLE "DriveScanSource" ADD COLUMN "webViewLink" TEXT;
ALTER TABLE "DriveScanSource" ADD COLUMN "lastScanStatus" TEXT;
ALTER TABLE "DriveScanSource" ADD COLUMN "lastScannedAt" DATETIME;
ALTER TABLE "DriveScanSource" ADD COLUMN "lastScanDurationMs" INTEGER;
ALTER TABLE "DriveScanSource" ADD COLUMN "lastScanAddedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriveScanSource" ADD COLUMN "lastScanUpdatedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriveScanSource" ADD COLUMN "lastScanDeletedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriveScanSource" ADD COLUMN "lastScanErrorCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriveScanSource" ADD COLUMN "lastScanError" TEXT;

CREATE TABLE "new_LibraryScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryId" TEXT NOT NULL,
    "driveScanSourceId" TEXT,
    "status" TEXT NOT NULL,
    "addedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "deletedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "LibraryScan_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LibraryScan_driveScanSourceId_fkey" FOREIGN KEY ("driveScanSourceId") REFERENCES "DriveScanSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_LibraryScan" (
    "id", "libraryId", "status", "addedCount", "updatedCount", "deletedCount",
    "errorCount", "durationMs", "startedAt", "completedAt"
)
SELECT
    "id", "libraryId", "status", "addedCount", "updatedCount", "deletedCount",
    "errorCount", "durationMs", "startedAt", "completedAt"
FROM "LibraryScan";

DROP TABLE "LibraryScan";
ALTER TABLE "new_LibraryScan" RENAME TO "LibraryScan";
CREATE INDEX "LibraryScan_driveScanSourceId_idx" ON "LibraryScan"("driveScanSourceId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
