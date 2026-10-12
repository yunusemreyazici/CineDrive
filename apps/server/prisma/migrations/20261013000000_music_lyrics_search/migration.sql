-- Derived text only; original/synchronized lyrics and revisions are preserved.
-- Existing rows are backfilled in bounded batches on server readiness.
ALTER TABLE "MusicLyrics" ADD COLUMN "searchText" TEXT;

CREATE VIRTUAL TABLE "MusicLyricsSearch" USING fts5(
  searchText,
  content = 'MusicLyrics',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);
INSERT INTO "MusicLyricsSearch" ("MusicLyricsSearch") VALUES ('rebuild');

CREATE TRIGGER "MusicLyricsSearch_after_insert" AFTER INSERT ON "MusicLyrics"
BEGIN
  INSERT INTO "MusicLyricsSearch" (rowid, searchText) VALUES (new.rowid, COALESCE(new.searchText, ''));
END;
CREATE TRIGGER "MusicLyricsSearch_after_delete" AFTER DELETE ON "MusicLyrics"
BEGIN
  INSERT INTO "MusicLyricsSearch" ("MusicLyricsSearch", rowid, searchText)
  VALUES ('delete', old.rowid, COALESCE(old.searchText, ''));
END;
CREATE TRIGGER "MusicLyricsSearch_after_update" AFTER UPDATE OF searchText ON "MusicLyrics"
BEGIN
  INSERT INTO "MusicLyricsSearch" ("MusicLyricsSearch", rowid, searchText)
  VALUES ('delete', old.rowid, COALESCE(old.searchText, ''));
  INSERT INTO "MusicLyricsSearch" (rowid, searchText) VALUES (new.rowid, COALESCE(new.searchText, ''));
END;
