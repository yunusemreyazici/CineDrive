CREATE TABLE "MusicStudioOperation" (
  "userId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "operationId"),
  CONSTRAINT "MusicStudioOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MusicStudioOperation_userId_createdAt_idx" ON "MusicStudioOperation"("userId", "createdAt");
CREATE TABLE "MusicPlaylistRevision" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "playlistId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "beforeItems" TEXT NOT NULL,
  "afterItems" TEXT NOT NULL,
  "addedCount" INTEGER NOT NULL,
  "removedCount" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusicPlaylistRevision_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "MusicPlaylist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MusicPlaylistRevision_playlistId_id_idx" ON "MusicPlaylistRevision"("playlistId", "id");
CREATE TABLE "MusicStudioChange" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusicStudioChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MusicStudioChange_userId_id_idx" ON "MusicStudioChange"("userId", "id");
