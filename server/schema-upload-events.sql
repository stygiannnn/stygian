-- Persistent log of upload events. Used to enforce the per-user daily upload
-- limit (10 / 24h) independently of the short-lived `uploads` table, since
-- files now expire after 5 hours and their rows are purged before the 24h
-- limit window closes. The app also creates this at runtime (CREATE TABLE IF
-- NOT EXISTS), so running this by hand is optional.
CREATE TABLE IF NOT EXISTS upload_events (
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_events_user ON upload_events (user_id, created_at);
