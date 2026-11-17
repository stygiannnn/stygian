-- Social connections for live follower/like stats + verified badges.
CREATE TABLE IF NOT EXISTS social_connections (
  user_id           TEXT NOT NULL,
  platform          TEXT NOT NULL,            -- 'tiktok' | 'pinterest' | 'twitter'
  platform_user_id  TEXT,
  platform_username TEXT,
  access_token      TEXT,
  refresh_token     TEXT,
  expires_at        INTEGER,                  -- unix seconds (access token expiry)
  stats             TEXT,                     -- JSON: display-safe stats only
  updated_at        INTEGER,
  PRIMARY KEY (user_id, platform)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state         TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  platform      TEXT NOT NULL,
  code_verifier TEXT,                         -- PKCE verifier (pinterest / twitter)
  created_at    INTEGER
);
