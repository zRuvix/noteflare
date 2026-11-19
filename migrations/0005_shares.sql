-- Read-only links to one note. The browser encrypts a snapshot (title and body) with a
-- random key that stays in the link's #fragment; this table only holds the ciphertext.
CREATE TABLE IF NOT EXISTS shares (
  id          TEXT PRIMARY KEY,           -- random, base64url, made by the browser
  user_id     TEXT NOT NULL,
  note_id     TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,              -- base64, AES-GCM, AAD "share:<id>"
  iv          TEXT NOT NULL,              -- base64, 12 bytes
  expires_at  INTEGER,                    -- epoch ms, NULL = never
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shares_note ON shares (user_id, note_id);
CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares (expires_at) WHERE expires_at IS NOT NULL;
