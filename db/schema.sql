CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  google_sub VARCHAR(255) UNIQUE,
  email VARCHAR(254) NOT NULL UNIQUE,
  full_name VARCHAR(100) NOT NULL,
  normalized_name VARCHAR(100) NOT NULL,
  password_hash TEXT,
  profile_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub_unique ON users(google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bills (
  id VARCHAR(7) PRIMARY KEY,
  title VARCHAR(80) NOT NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE bills ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY,
  bill_id VARCHAR(7) NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY,
  bill_id VARCHAR(7) NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  normalized_name VARCHAR(100) NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE participants ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE participants ALTER COLUMN name TYPE VARCHAR(100);
ALTER TABLE participants ALTER COLUMN normalized_name TYPE VARCHAR(100);
ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_bill_name_unique;

CREATE TABLE IF NOT EXISTS claims (
  id UUID PRIMARY KEY,
  bill_id VARCHAR(7) NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  quantity_milli INTEGER NOT NULL DEFAULT 0 CHECK (quantity_milli >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT claims_participant_item_unique UNIQUE (participant_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_users_normalized_name ON users(normalized_name);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_items_bill_id ON items(bill_id);
CREATE INDEX IF NOT EXISTS idx_claims_bill_id ON claims(bill_id);
CREATE INDEX IF NOT EXISTS idx_claims_item_id ON claims(item_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_bill_user_unique ON participants(bill_id, user_id) WHERE user_id IS NOT NULL;
