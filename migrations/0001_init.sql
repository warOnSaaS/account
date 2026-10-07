-- warOnSaaS account: people, the ways they sign in, their sessions, the apps that sign them in.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  updates_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON accounts (lower(email)) WHERE email IS NOT NULL;

-- One row per way in: a GitHub user, a Google user, an email address.
CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  login TEXT,
  name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (provider, subject)
);
CREATE INDEX IF NOT EXISTS identities_account ON identities (account_id);
CREATE INDEX IF NOT EXISTS identities_email ON identities (lower(email)) WHERE email_verified;

-- Apps that sign people in: our own (first party, no consent screen) and MCP clients that register themselves.
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  secret_hash TEXT,
  redirect_uris JSONB NOT NULL DEFAULT '[]',
  first_party BOOLEAN NOT NULL DEFAULT FALSE,
  home_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- browser: signed in here. app: one of our apps signed in through a browser session (ends with it).
-- connection: an AI app or script connected to the account or through one of our apps (lives on its own).
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  parent_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  client_id TEXT,
  label TEXT,
  scopes TEXT NOT NULL DEFAULT '',
  method TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);
CREATE INDEX IF NOT EXISTS sessions_parent ON sessions (parent_id);

-- Secrets handed out (browser cookie, access and refresh tokens), stored only as hashes.
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tokens_session ON tokens (session_id);

-- Authorization codes and email links: one use each.
CREATE TABLE IF NOT EXISTS one_time (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

-- Per-account rate limits that every app shares.
CREATE TABLE IF NOT EXISTS limits (
  account_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, bucket, window_start)
);

-- What happened to the account, for the person and for export.
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_account ON events (account_id, at DESC);

-- The key that signs ID tokens, sealed with ACCOUNT_SECRET. Made on first start.
CREATE TABLE IF NOT EXISTS signing_keys (
  kid TEXT PRIMARY KEY,
  sealed TEXT NOT NULL,
  public_jwk JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now());
