-- ============================================================================
-- Migration 01: Core Schema for AI Job Search & Resume Tailoring Automation
-- PostgreSQL 16+
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS n8n_internal;

-- Helper function to auto-update updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    linkedin_url TEXT,
    github_url TEXT,
    portfolio_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    schedule_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    retention_days INTEGER NOT NULL DEFAULT 90,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 2. user_preferences
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    target_job_titles JSONB NOT NULL DEFAULT '[]'::jsonb,
    years_of_experience NUMERIC(4,1) NOT NULL DEFAULT 0,
    technical_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    preferred_locations JSONB NOT NULL DEFAULT '[]'::jsonb,
    work_modes JSONB NOT NULL DEFAULT '["remote", "hybrid"]'::jsonb,
    work_authorization VARCHAR(255),
    employment_types JSONB NOT NULL DEFAULT '["full-time"]'::jsonb,
    salary_min NUMERIC(12,2),
    salary_max NUMERIC(12,2),
    salary_currency VARCHAR(10) DEFAULT 'USD',
    seniority_levels JSONB NOT NULL DEFAULT '["mid-level", "senior"]'::jsonb,
    preferred_companies JSONB NOT NULL DEFAULT '[]'::jsonb,
    excluded_companies JSONB NOT NULL DEFAULT '[]'::jsonb,
    notice_period VARCHAR(100),
    resume_output_format VARCHAR(20) NOT NULL DEFAULT 'both' CHECK (resume_output_format IN ('docx', 'pdf', 'both')),
    notification_method VARCHAR(30) NOT NULL DEFAULT 'email' CHECK (notification_method IN ('email', 'slack', 'telegram')),
    notification_target TEXT,
    immediate_strong_match_alert BOOLEAN NOT NULL DEFAULT TRUE,
    strong_match_threshold INTEGER NOT NULL DEFAULT 85 CHECK (strong_match_threshold BETWEEN 0 AND 100),
    search_frequency VARCHAR(20) NOT NULL DEFAULT 'daily' CHECK (search_frequency IN ('daily', 'weekdays', 'weekly')),
    max_jobs_per_run INTEGER NOT NULL DEFAULT 15 CHECK (max_jobs_per_run BETWEEN 1 AND 100),
    min_match_score INTEGER NOT NULL DEFAULT 70 CHECK (min_match_score BETWEEN 0 AND 100),
    scoring_weights JSONB NOT NULL DEFAULT '{
        "technical_skills": 35,
        "relevant_experience": 25,
        "role_alignment": 20,
        "location_work_mode": 10,
        "seniority_industry": 10
    }'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_user_preferences_updated_at
BEFORE UPDATE ON user_preferences
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 3. resumes (Master / Source Resumes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version_tag VARCHAR(64) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_format VARCHAR(15) NOT NULL CHECK (file_format IN ('pdf', 'docx', 'json')),
    storage_path TEXT NOT NULL,
    content_sha256 CHAR(64) NOT NULL,
    parsed_text TEXT NOT NULL,
    structured_resume JSONB NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resumes_user_current ON resumes(user_id, is_current);
CREATE UNIQUE INDEX IF NOT EXISTS uq_resumes_user_sha256 ON resumes(user_id, content_sha256);

-- ============================================================================
-- 4. job_sources
-- ============================================================================
CREATE TABLE IF NOT EXISTS job_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    source_type VARCHAR(50) NOT NULL CHECK (
        source_type IN ('greenhouse_api', 'lever_api', 'rss_feed', 'authorized_rest_api', 'web_scrape_api', 'job_search_aggregator')
    ),
    base_url TEXT NOT NULL,
    board_tokens JSONB NOT NULL DEFAULT '[]'::jsonb,
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 30,
    timeout_ms INTEGER NOT NULL DEFAULT 15000,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_polled_at TIMESTAMPTZ,
    last_status VARCHAR(50) DEFAULT 'idle',
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_job_sources_updated_at
BEFORE UPDATE ON job_sources
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 5. jobs (Normalized & Deduplicated Job Listings)
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id VARCHAR(255) NOT NULL,
    source VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    company VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL DEFAULT 'Unspecified',
    work_mode VARCHAR(50) NOT NULL DEFAULT 'unspecified' CHECK (work_mode IN ('remote', 'hybrid', 'onsite', 'unspecified')),
    employment_type VARCHAR(50) NOT NULL DEFAULT 'full-time',
    experience_required VARCHAR(120),
    required_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    preferred_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    job_description TEXT NOT NULL,
    description_sha256 CHAR(64) NOT NULL,
    salary_range VARCHAR(150),
    posted_at TIMESTAMPTZ,
    application_url TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    fallback_dedup_hash CHAR(64) NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(40) NOT NULL DEFAULT 'discovered' CHECK (
        status IN ('discovered', 'evaluated', 'qualified', 'below_threshold', 'excluded', 'tailored', 'qa_failed', 'delivered', 'archived')
    ),
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_jobs_source_job_id UNIQUE (source, job_id),
    CONSTRAINT uq_jobs_canonical_url UNIQUE (canonical_url)
);

CREATE INDEX IF NOT EXISTS idx_jobs_fallback_dedup ON jobs(fallback_dedup_hash);
CREATE INDEX IF NOT EXISTS idx_jobs_status_posted ON jobs(status, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_company_lower ON jobs(LOWER(company));

CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. job_matches (LLM Evaluation & Scoring Breakdown)
-- ============================================================================
CREATE TABLE IF NOT EXISTS job_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_uuid UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE RESTRICT,
    description_sha256 CHAR(64) NOT NULL,
    resume_sha256 CHAR(64) NOT NULL,
    overall_match_score INTEGER NOT NULL CHECK (overall_match_score BETWEEN 0 AND 100),
    score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    matching_required_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    missing_required_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    matching_preferred_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    relevant_experience JSONB NOT NULL DEFAULT '[]'::jsonb,
    potential_eligibility_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
    uncertain_flags_for_review JSONB NOT NULL DEFAULT '[]'::jsonb,
    location_employment_compatibility JSONB NOT NULL DEFAULT '{}'::jsonb,
    reasons_for_score TEXT NOT NULL,
    recommendation VARCHAR(30) NOT NULL CHECK (recommendation IN ('strong match', 'possible match', 'low match')),
    qualifies_for_tailoring BOOLEAN NOT NULL DEFAULT FALSE,
    llm_model VARCHAR(100),
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_job_matches_version UNIQUE (job_uuid, user_id, description_sha256, resume_sha256)
);

CREATE INDEX IF NOT EXISTS idx_job_matches_user_qualifies ON job_matches(user_id, qualifies_for_tailoring, overall_match_score DESC);

-- ============================================================================
-- 7. tailored_resumes (Generated Resumes & QA Verification Results)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tailored_resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_match_id UUID NOT NULL REFERENCES job_matches(id) ON DELETE CASCADE,
    job_uuid UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE RESTRICT,
    resume_version_id VARCHAR(80) NOT NULL UNIQUE,
    tailored_content_json JSONB NOT NULL,
    tailoring_summary TEXT NOT NULL,
    docx_filename VARCHAR(255),
    docx_storage_path TEXT,
    pdf_filename VARCHAR(255),
    pdf_storage_path TEXT,
    qa_status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (qa_status IN ('pending', 'passed', 'failed_manual_review')),
    qa_attempts INTEGER NOT NULL DEFAULT 1,
    qa_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    file_validation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tailored_resumes_match UNIQUE (job_match_id)
);

CREATE INDEX IF NOT EXISTS idx_tailored_resumes_qa_status ON tailored_resumes(user_id, qa_status);

CREATE TRIGGER trg_tailored_resumes_updated_at
BEFORE UPDATE ON tailored_resumes
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 8. notifications (Delivery Tracking & Idempotency)
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_uuid UUID REFERENCES jobs(id) ON DELETE SET NULL,
    tailored_resume_id UUID REFERENCES tailored_resumes(id) ON DELETE SET NULL,
    channel VARCHAR(30) NOT NULL CHECK (channel IN ('email', 'slack', 'telegram')),
    notification_type VARCHAR(30) NOT NULL CHECK (notification_type IN ('daily_digest', 'strong_match_immediate', 'admin_alert')),
    idempotency_key VARCHAR(180) NOT NULL UNIQUE,
    recipient TEXT NOT NULL,
    subject TEXT,
    delivery_status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'failed')),
    provider_message_id VARCHAR(255),
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications(user_id, delivery_status);

-- ============================================================================
-- 9. application_tracking (User Feedback Loop & Application Lifecycle)
-- ============================================================================
CREATE TABLE IF NOT EXISTS application_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_uuid UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    tailored_resume_id UUID REFERENCES tailored_resumes(id) ON DELETE SET NULL,
    feedback_status VARCHAR(40) NOT NULL CHECK (
        feedback_status IN (
            'interested',
            'not_interested',
            'already_applied',
            'interview_scheduled',
            'rejected',
            'offer_received'
        )
    ),
    user_notes TEXT,
    approval_required BOOLEAN NOT NULL DEFAULT TRUE,
    approved_for_submission BOOLEAN NOT NULL DEFAULT FALSE,
    applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_application_tracking_user_job UNIQUE (user_id, job_uuid)
);

CREATE INDEX IF NOT EXISTS idx_app_tracking_status ON application_tracking(user_id, feedback_status);

CREATE TRIGGER trg_application_tracking_updated_at
BEFORE UPDATE ON application_tracking
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 10. workflow_runs (Execution History & Monitoring)
-- ============================================================================
CREATE TABLE IF NOT EXISTS workflow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    n8n_execution_id VARCHAR(100) NOT NULL,
    workflow_name VARCHAR(120) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL CHECK (status IN ('running', 'completed', 'partial_failure', 'failed')),
    metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_summary TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_name_started ON workflow_runs(workflow_name, started_at DESC);

-- ============================================================================
-- 11. audit_events (Immutable Security & Compliance Trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    workflow_name VARCHAR(120) NOT NULL,
    n8n_execution_id VARCHAR(100),
    event_type VARCHAR(80) NOT NULL,
    entity_type VARCHAR(60),
    entity_id VARCHAR(120),
    details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_type_created ON audit_events(event_type, created_at DESC);

-- ============================================================================
-- 12. Data Retention & User Deletion Stored Procedures
-- ============================================================================
CREATE OR REPLACE FUNCTION purge_expired_user_data(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_retention_days INTEGER;
    v_deleted_jobs INTEGER := 0;
    v_deleted_audits INTEGER := 0;
BEGIN
    SELECT retention_days INTO v_retention_days FROM users WHERE id = p_user_id;
    IF v_retention_days IS NULL THEN
        RAISE EXCEPTION 'User % not found', p_user_id;
    END IF;

    DELETE FROM jobs
    WHERE last_seen_at < NOW() - (v_retention_days || ' days')::INTERVAL
      AND id NOT IN (
          SELECT job_uuid FROM application_tracking
          WHERE user_id = p_user_id
            AND feedback_status IN ('interested', 'already_applied', 'interview_scheduled', 'offer_received')
      );
    GET DIAGNOSTICS v_deleted_jobs = ROW_COUNT;

    DELETE FROM audit_events
    WHERE user_id = p_user_id
      AND created_at < NOW() - (v_retention_days || ' days')::INTERVAL;
    GET DIAGNOSTICS v_deleted_audits = ROW_COUNT;

    RETURN jsonb_build_object(
        'user_id', p_user_id,
        'retention_days', v_retention_days,
        'deleted_jobs', v_deleted_jobs,
        'deleted_audit_events', v_deleted_audits,
        'purged_at', NOW()
    );
END;
$$ LANGUAGE plpgsql;
