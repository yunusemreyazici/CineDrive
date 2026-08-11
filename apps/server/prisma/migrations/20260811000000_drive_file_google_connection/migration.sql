-- A library can be scanned from more than one Google account over time. Keep
-- the credential owner on each file instead of deriving it from the library's
-- currently selected scan account. Existing rows remain NULL and are repaired
-- lazily after verifying which connected account can read the Drive file.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_DriveFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryId" TEXT NOT NULL,
    "googleConnectionId" TEXT,
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
    CONSTRAINT "DriveFile_googleConnectionId_fkey" FOREIGN KEY ("googleConnectionId") REFERENCES "GoogleConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_DriveFile" (
    "id", "libraryId", "storageType", "localFilePath", "googleDriveFileId",
    "parentDriveFileId", "name", "mimeType", "size", "modifiedTime",
    "md5Checksum", "mediaContainer", "videoCodec", "videoProfile",
    "videoBitDepth", "audioCodec", "audioChannels", "audioSampleRate",
    "audioBitrate", "audioBitDepth", "audioLossless", "mediaWidth",
    "mediaHeight", "mediaDuration", "mediaAnalyzedAt", "mediaAnalysisError",
    "status", "createdAt", "updatedAt"
)
SELECT
    "id", "libraryId", "storageType", "localFilePath", "googleDriveFileId",
    "parentDriveFileId", "name", "mimeType", "size", "modifiedTime",
    "md5Checksum", "mediaContainer", "videoCodec", "videoProfile",
    "videoBitDepth", "audioCodec", "audioChannels", "audioSampleRate",
    "audioBitrate", "audioBitDepth", "audioLossless", "mediaWidth",
    "mediaHeight", "mediaDuration", "mediaAnalyzedAt", "mediaAnalysisError",
    "status", "createdAt", "updatedAt"
FROM "DriveFile";

DROP TABLE "DriveFile";
ALTER TABLE "new_DriveFile" RENAME TO "DriveFile";

CREATE UNIQUE INDEX "DriveFile_localFilePath_key" ON "DriveFile"("localFilePath");
CREATE UNIQUE INDEX "DriveFile_googleDriveFileId_key" ON "DriveFile"("googleDriveFileId");
CREATE INDEX "DriveFile_libraryId_idx" ON "DriveFile"("libraryId");
CREATE INDEX "DriveFile_googleConnectionId_idx" ON "DriveFile"("googleConnectionId");
CREATE INDEX "DriveFile_parentDriveFileId_idx" ON "DriveFile"("parentDriveFileId");
CREATE INDEX "DriveFile_localFilePath_idx" ON "DriveFile"("localFilePath");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
