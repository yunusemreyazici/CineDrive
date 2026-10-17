ALTER TABLE "MusicPlaylist" ADD COLUMN "invitationHash" TEXT;
ALTER TABLE "MusicPlaylist" ADD COLUMN "invitationExpiresAt" DATETIME;
CREATE UNIQUE INDEX "MusicPlaylist_invitationHash_key" ON "MusicPlaylist"("invitationHash");
ALTER TABLE "MusicPlaylistItem" ADD COLUMN "addedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
