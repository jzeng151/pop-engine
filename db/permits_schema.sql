-- 1. NYC Parks Permit Records & Status Tracking
CREATE TABLE IF NOT EXISTS park_permit_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    park_location_id VARCHAR(64) NOT NULL,      -- NYC Socrata Park ID (c5vm-g2dk)
    park_name VARCHAR(255) NOT NULL,
    borough VARCHAR(50) NOT NULL,
    lead_time_days INT NOT NULL DEFAULT 30,
    expected_attendance INT NOT NULL,
    has_amplified_sound BOOLEAN DEFAULT FALSE,
    has_temporary_structures BOOLEAN DEFAULT FALSE, -- Tents, stages, generators
    has_vending BOOLEAN DEFAULT FALSE,
    
    -- Submission State
    permit_status VARCHAR(50) NOT NULL DEFAULT 'DRAFT', -- DRAFT, SUBMITTED, APPROVED, REJECTED
    nyc_portal_reference_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Insurance Verification Vault (COI Tracking)
CREATE TABLE IF NOT EXISTS permit_insurance_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permit_application_id UUID REFERENCES park_permit_applications(id) ON DELETE CASCADE,
    provider_name VARCHAR(255) NOT NULL,
    policy_number VARCHAR(100) NOT NULL,
    coverage_amount_per_occurrence NUMERIC(12, 2) NOT NULL, -- e.g., 1000000.00
    aggregate_coverage_amount NUMERIC(12, 2) NOT NULL,      -- e.g., 2000000.00
    city_named_additional_insured BOOLEAN NOT NULL DEFAULT FALSE,
    document_hash VARCHAR(64) NOT NULL,                    -- SHA-256 hash of COI file
    verification_status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
);

CREATE INDEX IF NOT EXISTS idx_park_permit_event ON park_permit_applications(event_id);

