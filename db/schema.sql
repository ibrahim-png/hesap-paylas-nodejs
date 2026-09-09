CREATE TABLE IF NOT EXISTS bills (
  id VARCHAR(7) PRIMARY KEY,
  title VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  name VARCHAR(50) NOT NULL,
  normalized_name VARCHAR(50) NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT participants_bill_name_unique UNIQUE (bill_id, normalized_name)
);

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

CREATE INDEX IF NOT EXISTS idx_items_bill_id ON items(bill_id);
CREATE INDEX IF NOT EXISTS idx_claims_bill_id ON claims(bill_id);
CREATE INDEX IF NOT EXISTS idx_claims_item_id ON claims(item_id);
