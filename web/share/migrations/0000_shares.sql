CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('skill', 'prompt')),
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  creator_id TEXT,
  revoked_at INTEGER
);

CREATE INDEX shares_type_created_at_idx ON shares(type, created_at);

CREATE TABLE share_rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
