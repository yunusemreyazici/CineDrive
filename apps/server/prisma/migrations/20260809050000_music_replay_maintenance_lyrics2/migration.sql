-- Automatic music maintenance proposals and reversible actions.
CREATE TABLE "MusicMaintenanceSuggestion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "confidence" INTEGER NOT NULL,
  "currentData" TEXT NOT NULL,
  "proposedData" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" DATETIME,
  CONSTRAINT "MusicMaintenanceSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MusicMaintenanceSuggestion_userId_status_createdAt_idx" ON "MusicMaintenanceSuggestion"("userId", "status", "createdAt");
CREATE INDEX "MusicMaintenanceSuggestion_targetType_targetId_idx" ON "MusicMaintenanceSuggestion"("targetType", "targetId");

CREATE TABLE "MusicMaintenanceAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "beforeData" TEXT NOT NULL,
  "afterData" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revertedAt" DATETIME,
  CONSTRAINT "MusicMaintenanceAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MusicMaintenanceAction_userId_createdAt_idx" ON "MusicMaintenanceAction"("userId", "createdAt");

-- Multiple stored translations and non-destructive community LRC imports.
CREATE TABLE "MusicLyricsTranslation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "lyricsId" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'manual',
  "isMachine" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MusicLyricsTranslation_lyricsId_fkey" FOREIGN KEY ("lyricsId") REFERENCES "MusicLyrics" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MusicLyricsTranslation_lyricsId_language_key" ON "MusicLyricsTranslation"("lyricsId", "language");
CREATE INDEX "MusicLyricsTranslation_lyricsId_idx" ON "MusicLyricsTranslation"("lyricsId");

CREATE TABLE "MusicLyricsRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "lyricsId" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" DATETIME,
  CONSTRAINT "MusicLyricsRevision_lyricsId_fkey" FOREIGN KEY ("lyricsId") REFERENCES "MusicLyrics" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MusicLyricsRevision_lyricsId_status_idx" ON "MusicLyricsRevision"("lyricsId", "status");

INSERT INTO "MusicLyricsTranslation" ("id", "lyricsId", "language", "content", "provider", "isMachine", "createdAt", "updatedAt")
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
       "id", COALESCE("translationLang", 'und'), "translatedContent", 'legacy', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "MusicLyrics" WHERE "translatedContent" IS NOT NULL AND trim("translatedContent") <> '';
