CREATE TABLE "MusicPlaylistMembership" (
  "playlistId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'editor',
  "accepted" BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY ("playlistId", "userId"),
  CONSTRAINT "MusicPlaylistMembership_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "MusicPlaylist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MusicPlaylistMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MusicPlaylistMembership_userId_accepted_idx" ON "MusicPlaylistMembership"("userId", "accepted");
CREATE TABLE "MusicStudio" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "content" TEXT NOT NULL DEFAULT '{}',
  CONSTRAINT "MusicStudio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
