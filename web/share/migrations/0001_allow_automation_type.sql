-- SQLite cannot alter a CHECK constraint, so rebuild `shares` with the widened
-- type list. Nothing references `shares` via foreign keys.
ALTER TABLE shares RENAME TO shares_old;

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('skill', 'prompt', 'automation')),
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  creator_id TEXT,
  revoked_at INTEGER
);

INSERT INTO shares (id, type, payload, created_at, creator_id, revoked_at)
SELECT id, type, payload, created_at, creator_id, revoked_at FROM shares_old;

DROP TABLE shares_old;

CREATE INDEX shares_type_created_at_idx ON shares(type, created_at);
