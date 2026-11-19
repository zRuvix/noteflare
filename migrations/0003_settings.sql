-- Settings saved by the app itself, such as the Cloudflare Access login created by the
-- in-app setup (access_team_domain, access_aud, allowed_emails) and the one-time code
-- that setup uses to check an API token belongs to this deployment (setup_code).
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
