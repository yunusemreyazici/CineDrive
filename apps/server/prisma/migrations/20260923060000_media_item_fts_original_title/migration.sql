-- The search index is derived from MediaItem. Rebuild it with originalTitle so
-- server-side pagination preserves Media Manager's original-title search.
DROP TRIGGER "MediaItemSearch_after_insert";
DROP TRIGGER "MediaItemSearch_after_delete";
DROP TRIGGER "MediaItemSearch_after_update";
DROP TABLE "MediaItemSearch";

CREATE VIRTUAL TABLE "MediaItemSearch" USING fts5(
  title,
  originalTitle,
  normalizedTitle,
  cast,
  genres,
  content = 'MediaItem',
  content_rowid = 'rowid',
  tokenize = 'trigram'
);

INSERT INTO "MediaItemSearch" ("MediaItemSearch") VALUES ('rebuild');

CREATE TRIGGER "MediaItemSearch_after_insert"
AFTER INSERT ON "MediaItem"
BEGIN
  INSERT INTO "MediaItemSearch" (rowid, title, originalTitle, normalizedTitle, cast, genres)
  VALUES (new.rowid, new.title, new.originalTitle, new.normalizedTitle, COALESCE(new.cast, ''), COALESCE(new.genres, ''));
END;

CREATE TRIGGER "MediaItemSearch_after_delete"
AFTER DELETE ON "MediaItem"
BEGIN
  INSERT INTO "MediaItemSearch" ("MediaItemSearch", rowid, title, originalTitle, normalizedTitle, cast, genres)
  VALUES ('delete', old.rowid, old.title, old.originalTitle, old.normalizedTitle, COALESCE(old.cast, ''), COALESCE(old.genres, ''));
END;

CREATE TRIGGER "MediaItemSearch_after_update"
AFTER UPDATE OF id, title, originalTitle, normalizedTitle, cast, genres ON "MediaItem"
BEGIN
  INSERT INTO "MediaItemSearch" ("MediaItemSearch", rowid, title, originalTitle, normalizedTitle, cast, genres)
  VALUES ('delete', old.rowid, old.title, old.originalTitle, old.normalizedTitle, COALESCE(old.cast, ''), COALESCE(old.genres, ''));
  INSERT INTO "MediaItemSearch" (rowid, title, originalTitle, normalizedTitle, cast, genres)
  VALUES (new.rowid, new.title, new.originalTitle, new.normalizedTitle, COALESCE(new.cast, ''), COALESCE(new.genres, ''));
END;
