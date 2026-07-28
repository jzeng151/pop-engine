-- Enable security and cryptographic extensions natively in Postgres
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enum for tracking PopEngine compliance and submission events
CREATE TYPE audit_action_type AS ENUM (
    'CREDENTIAL_STORED',
    'CREDENTIAL_REVOKED',
    'PERMIT_SUBMISSION_INITIATED',
    'PERMIT_SUBMISSION_COMPLETED',
    'PERMIT_SUBMISSION_FAILED',
    'INSPECTOR_VERIFICATION_CHECK'
);

-- Append-Only Compliance Audit Log Table
CREATE TABLE IF NOT EXISTS compliance_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,                     -- Identity of the Event Ops Manager
    public_token_id VARCHAR(64) NOT NULL,      -- Reference to credential vault token (never plain secrets)
    action audit_action_type NOT NULL,
    
    -- Target municipal telemetry
    jurisdiction_endpoint VARCHAR(255) NOT NULL, -- e.g., 'https://nyceventpermits.nyc.gov'
    client_ip_address INET NOT NULL,             -- Proves geographic origin of request
    user_agent TEXT NOT NULL,                    -- Device fingerprint
    
    -- Structured immutable payload
    action_payload JSONB NOT NULL,               -- Form hashes, permit IDs, or status blocks
    
    -- Cryptographic Non-Repudiation
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    previous_row_hash VARCHAR(64),
    current_row_hash VARCHAR(64) UNIQUE NOT NULL
);

-- Indexing for fast legal discovery and auditing
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON compliance_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_token ON compliance_audit_log(public_token_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON compliance_audit_log(timestamp DESC);

-- HARDENING TRIGGER: Prevent any modifications or deletions at the DB engine level
CREATE OR REPLACE FUNCTION block_alter_audit_log()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'LEGAL COMPLIANCE VIOLATION: The compliance audit log is append-only. Modifying or deleting records is strictly prohibited.';
END;
$$ LANGUAGE plpgsql;

-- Apply trigger for DELETE operations
DROP TRIGGER IF EXISTS trg_protect_audit_delete ON compliance_audit_log;
CREATE TRIGGER trg_protect_audit_delete
BEFORE DELETE ON compliance_audit_log
FOR EACH ROW EXECUTE FUNCTION block_alter_audit_log();

-- Apply trigger for UPDATE operations
DROP TRIGGER IF EXISTS trg_protect_audit_update ON compliance_audit_log;
CREATE TRIGGER trg_protect_audit_update
BEFORE UPDATE ON compliance_audit_log
FOR EACH ROW EXECUTE FUNCTION block_alter_audit_log();
