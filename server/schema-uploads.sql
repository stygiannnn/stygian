-- Temporary uploads (images / gifs / videos), auto-expire after 24h.
CREATE TABLE IF NOT EXISTS uploads (
  id           TEXT PRIMARY KEY,   -- short id used in the /f/<id>.<ext> URL
  user_id      TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  filename     TEXT,
  content_type TEXT,
  ext          TEXT,
  size         INTEGER,
  created_at   INTEGER,
  expires_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_uploads_expires ON uploads(expires_at);
