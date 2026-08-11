PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "DriveScanSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryId" TEXT NOT NULL,
    "googleConnectionId" TEXT NOT NULL,
    "rootFolderId" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DriveScanSource_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DriveScanSource_googleConnectionId_fkey" FOREIGN KEY ("googleConnectionId") REFERENCES "GoogleConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DriveScanSource_libraryId_googleConnectionId_rootFolderId_key"
ON "DriveScanSource"("libraryId", "googleConnectionId", "rootFolderId");
CREATE INDEX "DriveScanSource_libraryId_idx" ON "DriveScanSource"("libraryId");
CREATE INDEX "DriveScanSource_googleConnectionId_idx" ON "DriveScanSource"("googleConnectionId");

CREATE TABLE "new_DriveFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryId" TEXT NOT NULL,
    "googleConnectionId" TEXT,
    "driveScanSourceId" TEXT,
    "storageType" TEXT NOT NULL DEFAULT 'gdrive',
    "localFilePath" TEXT,
    "googleDriveFileId" TEXT,
    "parentDriveFileId" TEXT,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT,
    "modifiedTime" DATETIME,
    "md5Checksum" TEXT,
    "mediaContainer" TEXT,
    "videoCodec" TEXT,
    "videoProfile" TEXT,
    "videoBitDepth" INTEGER,
    "audioCodec" TEXT,
    "audioChannels" INTEGER,
    "audioSampleRate" INTEGER,
    "audioBitrate" INTEGER,
    "audioBitDepth" INTEGER,
    "audioLossless" BOOLEAN,
    "mediaWidth" INTEGER,
    "mediaHeight" INTEGER,
    "mediaDuration" REAL,
    "mediaAnalyzedAt" DATETIME,
    "mediaAnalysisError" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DriveFile_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DriveFile_googleConnectionId_fkey" FOREIGN KEY ("googleConnectionId") REFERENCES "GoogleConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DriveFile_driveScanSourceId_fkey" FOREIGN KEY ("driveScanSourceId") REFERENCES "DriveScanSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_DriveFile" (
    "id", "libraryId", "googleConnectionId", "storageType", "localFilePath",
    "googleDriveFileId", "parentDriveFileId", "name", "mimeType", "size",
    "modifiedTime", "md5Checksum", "mediaContainer", "videoCodec",
    "videoProfile", "videoBitDepth", "audioCodec", "audioChannels",
    "audioSampleRate", "audioBitrate", "audioBitDepth", "audioLossless",
    "mediaWidth", "mediaHeight", "mediaDuration", "mediaAnalyzedAt",
    "mediaAnalysisError", "status", "createdAt", "updatedAt"
)
SELECT
    "id", "libraryId", "googleConnectionId", "storageType", "localFilePath",
    "googleDriveFileId", "parentDriveFileId", "name", "mimeType", "size",
    "modifiedTime", "md5Checksum", "mediaContainer", "videoCodec",
    "videoProfile", "videoBitDepth", "audioCodec", "audioChannels",
    "audioSampleRate", "audioBitrate", "audioBitDepth", "audioLossless",
    "mediaWidth", "mediaHeight", "mediaDuration", "mediaAnalyzedAt",
    "mediaAnalysisError", "status", "createdAt", "updatedAt"
FROM "DriveFile";

DROP TABLE "DriveFile";
ALTER TABLE "new_DriveFile" RENAME TO "DriveFile";

CREATE UNIQUE INDEX "DriveFile_localFilePath_key" ON "DriveFile"("localFilePath");
CREATE UNIQUE INDEX "DriveFile_googleDriveFileId_key" ON "DriveFile"("googleDriveFileId");
CREATE INDEX "DriveFile_libraryId_idx" ON "DriveFile"("libraryId");
CREATE INDEX "DriveFile_googleConnectionId_idx" ON "DriveFile"("googleConnectionId");
CREATE INDEX "DriveFile_driveScanSourceId_idx" ON "DriveFile"("driveScanSourceId");
CREATE INDEX "DriveFile_parentDriveFileId_idx" ON "DriveFile"("parentDriveFileId");
CREATE INDEX "DriveFile_localFilePath_idx" ON "DriveFile"("localFilePath");

-- Preserve the currently configured folder as the first manageable source.
INSERT OR IGNORE INTO "DriveScanSource" (
    "id", "libraryId", "googleConnectionId", "rootFolderId", "createdAt", "updatedAt"
)
SELECT
    lower(hex(randomblob(16))), "id", "googleConnectionId", "rootFolderId",
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Library"
WHERE "storageType" = 'gdrive' AND "googleConnectionId" IS NOT NULL;

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
