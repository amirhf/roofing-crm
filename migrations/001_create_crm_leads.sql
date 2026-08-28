CREATE TABLE IF NOT EXISTS crm_leads (
  lead_id uuid PRIMARY KEY,
  session_id_hash text NOT NULL CHECK (session_id_hash ~ '^sha256:[a-f0-9]{64}$'),
  oracle_reference_key text NOT NULL CHECK (oracle_reference_key ~ '^leadref_[a-f0-9]{32}$'),
  oracle_contract_version text NOT NULL CHECK (oracle_contract_version = '1.0.0'),
  oracle_schema_hash text NOT NULL CHECK (oracle_schema_hash ~ '^[a-f0-9]{64}$'),
  property_id text NOT NULL CHECK (property_id ~ '^prop_[a-f0-9]{32}$'),
  permit_id text CHECK (permit_id IS NULL OR permit_id ~ '^perm_[a-f0-9]{32}$'),
  source_publication_cid text,
  source_captured_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('new', 'qualified', 'contacted', 'won', 'lost')),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 10000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  session_expires_at timestamptz NOT NULL,
  UNIQUE (session_id_hash, oracle_reference_key)
);

CREATE INDEX IF NOT EXISTS crm_leads_session_updated_idx
  ON crm_leads (session_id_hash, updated_at DESC);

CREATE INDEX IF NOT EXISTS crm_leads_expiry_idx
  ON crm_leads (session_expires_at);
