-- Teams: a brand kit and a data home each. Everyone starts with a team of their own.
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  personal BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  brand JSONB NOT NULL DEFAULT '{}',
  -- kind: cloud (our Postgres, rows scoped by team), postgres (their DATABASE_URL), github (a repo they own)
  data_home JSONB NOT NULL DEFAULT '{"kind":"cloud"}',
  -- Their DATABASE_URL, sealed with ACCOUNT_SECRET. Never sent back to a screen.
  data_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, account_id)
);
CREATE INDEX IF NOT EXISTS team_members_account ON team_members (account_id);

CREATE TABLE IF NOT EXISTS team_invites (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS team_invites_email ON team_invites (lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- A tool marked confirm: human, asked for by an AI app: it waits here until the person says yes on a screen.
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  input JSONB NOT NULL DEFAULT '{}',
  asked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  answered_at TIMESTAMPTZ,
  answer TEXT
);
CREATE INDEX IF NOT EXISTS approvals_account ON approvals (account_id) WHERE answered_at IS NULL;

-- A move of a team's data from one home to another, step by step, per app.
CREATE TABLE IF NOT EXISTS moves (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  from_home JSONB NOT NULL,
  to_home JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  steps JSONB NOT NULL DEFAULT '[]',
  started_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'registered';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS app TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS team_id TEXT;
