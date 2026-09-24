CREATE VIRTUAL TABLE "MediaItemSearch" USING fts5(
  title,
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
  INSERT INTO "MediaItemSearch" (rowid, title, normalizedTitle, cast, genres)
  VALUES (new.rowid, new.title, new.normalizedTitle, COALESCE(new.cast, ''), COALESCE(new.genres, ''));
END;

CREATE TRIGGER "MediaItemSearch_after_delete"
AFTER DELETE ON "MediaItem"
BEGIN
  INSERT INTO "MediaItemSearch" ("MediaItemSearch", rowid, title, normalizedTitle, cast, genres)
  VALUES ('delete', old.rowid, old.title, old.normalizedTitle, COALESCE(old.cast, ''), COALESCE(old.genres, ''));
END;

CREATE TRIGGER "MediaItemSearch_after_update"
AFTER UPDATE OF id, title, normalizedTitle, cast, genres ON "MediaItem"
BEGIN
  INSERT INTO "MediaItemSearch" ("MediaItemSearch", rowid, title, normalizedTitle, cast, genres)
  VALUES ('delete', old.rowid, old.title, old.normalizedTitle, COALESCE(old.cast, ''), COALESCE(old.genres, ''));
  INSERT INTO "MediaItemSearch" (rowid, title, normalizedTitle, cast, genres)
  VALUES (new.rowid, new.title, new.normalizedTitle, COALESCE(new.cast, ''), COALESCE(new.genres, ''));
END;
