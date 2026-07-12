-- Migration: 0001_init.sql
-- Sift ATS — initial schema
-- Matches plan.md §2 (entities), §6 (serverless implications: sessions/rate-limiting live in Postgres, not memory)

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ============================================================
-- Tenancy
-- ============================================================

CREATE TABLE organization (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Auth & Users
-- ============================================================

CREATE TYPE user_role AS ENUM ('admin', 'recruiter', 'interviewer');

CREATE TABLE app_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email           text NOT NULL UNIQUE,
  password_hash   text NOT NULL,               -- Argon2id
  role            user_role NOT NULL DEFAULT 'interviewer',
  email_verified  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_user_organization_id ON app_user(organization_id);

-- Sessions live in Postgres, not in-memory, because Vercel serverless
-- functions share no memory between invocations (plan.md §6).
CREATE TABLE session (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- this is the value stored in the httpOnly cookie
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_user_id ON session(user_id);
CREATE INDEX idx_session_expires_at ON session(expires_at); -- for periodic cleanup of expired rows

-- Single-use, hashed-at-rest tokens for password reset, email verification,
-- AND org invites (same shape, different "kind" — avoids near-identical tables).
CREATE TYPE token_kind AS ENUM ('password_reset', 'email_verification', 'org_invite');

CREATE TABLE auth_token (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            token_kind NOT NULL,
  token_hash      text NOT NULL,                -- never store the raw token
  -- password_reset and email_verification tokens reference a user directly:
  user_id         uuid REFERENCES app_user(id) ON DELETE CASCADE,
  -- org_invite tokens reference an org + the role the invitee will get:
  organization_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  invite_role     user_role,                     -- only set when kind = 'org_invite'; must be 'recruiter' or 'interviewer'
  created_by      uuid REFERENCES app_user(id),   -- who generated an org_invite token; null otherwise
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_token_user_scoped_has_user
    CHECK (kind NOT IN ('password_reset', 'email_verification') OR user_id IS NOT NULL),
  CONSTRAINT auth_token_invite_has_org_and_role
    CHECK (kind <> 'org_invite' OR (organization_id IS NOT NULL AND invite_role IN ('recruiter', 'interviewer')))
);

CREATE INDEX idx_auth_token_hash ON auth_token(token_hash);

-- Rate limiting lives in Postgres for the same reason sessions do: no shared
-- memory across serverless invocations. One row per (identifier, route).
CREATE TABLE rate_limit_attempt (
  identifier     text NOT NULL,     -- e.g. "ip:1.2.3.4|account:user@example.com" or "ip:1.2.3.4|route:reset"
  route          text NOT NULL,     -- 'login' | 'password_reset' | etc — keeps counters independent per sensitive route
  attempt_count  integer NOT NULL DEFAULT 1,
  window_start   timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identifier, route)
);

-- ============================================================
-- Jobs
-- ============================================================

CREATE TYPE job_status AS ENUM ('draft', 'open', 'closed');

CREATE TABLE job (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  title           text NOT NULL,
  department      text NOT NULL,
  status          job_status NOT NULL DEFAULT 'draft',
  description     text,                 -- intentionally nullable: a job can exist before its description is written
  created_by      uuid NOT NULL REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_organization_id ON job(organization_id);
CREATE INDEX idx_job_org_status ON job(organization_id, status);

-- ============================================================
-- Candidates & Applications
-- ============================================================

CREATE TYPE candidate_source AS ENUM ('referral', 'job_board', 'direct', 'other');

CREATE TABLE candidate (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name            text NOT NULL,
  email           text NOT NULL,
  resume_url      text,
  source          candidate_source NOT NULL DEFAULT 'other',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_candidate_organization_id ON candidate(organization_id);
-- Trigram index for server-side fuzzy search on name/email (plan.md §3 C3).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_candidate_name_trgm ON candidate USING gin (name gin_trgm_ops);
CREATE INDEX idx_candidate_email_trgm ON candidate USING gin (email gin_trgm_ops);

CREATE TYPE application_stage AS ENUM ('applied', 'screen', 'interview', 'offer', 'hired', 'rejected');

CREATE TABLE application (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE, -- denormalized: cheap row-level auth checks (plan.md §4)
  candidate_id    uuid NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
  job_id          uuid NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  stage           application_stage NOT NULL DEFAULT 'applied',
  deleted_at      timestamptz,          -- soft delete when parent job is deleted
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, job_id)
);

CREATE INDEX idx_application_org_job_stage ON application(organization_id, job_id, stage);
CREATE INDEX idx_application_candidate_id ON application(candidate_id);

-- ============================================================
-- Interviews & Scorecards
-- ============================================================

CREATE TABLE interview (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  application_id  uuid NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  interviewer_id  uuid NOT NULL REFERENCES app_user(id),
  scheduled_at    timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_interview_interviewer_id ON interview(interviewer_id);
CREATE INDEX idx_interview_application_id ON interview(application_id);

CREATE TABLE scorecard (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id  uuid NOT NULL UNIQUE REFERENCES interview(id) ON DELETE CASCADE,
  submitted_by  uuid NOT NULL REFERENCES app_user(id),
  ratings       jsonb NOT NULL,       -- { "<competency>": 1-4, ... }
  notes         text,                 -- intentionally nullable: ratings alone are a valid minimal scorecard
  submitted_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- updated_at auto-touch trigger (applied to every table with updated_at)
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_app_user_updated_at BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_job_updated_at BEFORE UPDATE ON job
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_application_updated_at BEFORE UPDATE ON application
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
