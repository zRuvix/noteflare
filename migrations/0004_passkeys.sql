-- Passkeys that unlock the vault (WebAuthn PRF). Each row holds one more wrapped copy
-- of the user's data key; the wrapping key comes from the passkey's PRF output, which
-- only the browser sees. Removing a row removes that way to unlock.
CREATE TABLE IF NOT EXISTS passkeys (
  user_id      TEXT NOT NULL,
  id           TEXT NOT NULL,             -- WebAuthn credential id, base64url
  name         TEXT NOT NULL,
  salt         TEXT NOT NULL,             -- base64, the PRF input
  wrapped_dek  TEXT NOT NULL,             -- base64(iv || AES-GCM(KEK_passkey, DEK))
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
