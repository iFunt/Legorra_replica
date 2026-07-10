-- GDPR claims platform: claims, staged pipeline events, research/valuation/
-- drafting artifacts, a curated GDPR knowledge base, and a document text
-- extraction cache. Access control for these tables is enforced in the
-- Express layer (see backend/src/lib/access.ts), matching the existing
-- pattern for projects/documents/tabular_reviews — the backend talks to
-- Supabase with the service-role key, so RLS is not relied on here beyond
-- what's already established for user_profiles.

-- ---------------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------------

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project_id uuid references public.projects(id) on delete set null,
  company_name text not null,
  company_number text,
  issue_summary text not null,
  stage text not null default 'acknowledged'
    check (stage = any (array[
      'acknowledged'::text,
      'researching'::text,
      'research_complete'::text,
      'valuation'::text,
      'pre_action_drafting'::text,
      'internal_review'::text,
      'ready_to_send'::text,
      'sent'::text,
      'resolved'::text,
      'on_hold'::text
    ])),
  claim_value_low numeric,
  claim_value_high numeric,
  claim_value_currency text not null default 'GBP',
  confidence_score numeric,
  shared_with jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_claims_user
  on public.claims(user_id);

create index if not exists idx_claims_project
  on public.claims(project_id);

create index if not exists idx_claims_stage
  on public.claims(stage);

-- Attach documents (uploaded DSAR responses, evidence, etc.) to a claim,
-- reusing the existing `documents` table rather than a separate one.
alter table public.documents
  add column if not exists claim_id uuid references public.claims(id) on delete set null;

create index if not exists idx_documents_claim
  on public.documents(claim_id);

-- ---------------------------------------------------------------------------
-- Claim timeline / orchestration checkpoints
-- ---------------------------------------------------------------------------

create table if not exists public.claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  type text not null
    check (type = any (array[
      'stage_change'::text,
      'research_run'::text,
      'draft_iteration'::text,
      'judge_score'::text,
      'system_note'::text,
      'user_action'::text,
      'error'::text
    ])),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_claim_events_claim
  on public.claim_events(claim_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Company research
-- ---------------------------------------------------------------------------

create table if not exists public.claim_research (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  registered_office jsonb,
  sic_codes jsonb,
  directors_summary text,
  privacy_policy_url text,
  privacy_policy_summary text,
  ico_fines jsonb not null default '[]'::jsonb,
  ico_enforcement_notices jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  raw_model_output jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_claim_research_claim
  on public.claim_research(claim_id);

-- ---------------------------------------------------------------------------
-- Draft iterations (drafter + judge loop)
-- ---------------------------------------------------------------------------

create table if not exists public.claim_drafts (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  kind text not null
    check (kind = any (array[
      'dsar_followup'::text,
      'letter_before_action'::text,
      'particulars_of_claim'::text
    ])),
  version integer not null default 1,
  content text not null,
  judge_score numeric,
  judge_feedback jsonb,
  status text not null default 'drafting'
    check (status = any (array[
      'drafting'::text,
      'reviewed'::text,
      'approved'::text,
      'sent'::text
    ])),
  created_at timestamptz not null default now()
);

create index if not exists idx_claim_drafts_claim
  on public.claim_drafts(claim_id, kind, version desc);

-- ---------------------------------------------------------------------------
-- GDPR knowledge base (shared reference data, not user-owned)
-- ---------------------------------------------------------------------------

create table if not exists public.gdpr_kb (
  id uuid primary key default gen_random_uuid(),
  category text not null
    check (category = any (array[
      'statute'::text,
      'case_law'::text,
      'ico_case'::text,
      'distress_wording'::text,
      'guidance'::text
    ])),
  title text not null,
  citation text,
  summary text not null,
  full_text text,
  tags text[] not null default '{}',
  jurisdiction text not null default 'UK',
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(citation, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(full_text, '')), 'C')
  ) stored
);

create index if not exists idx_gdpr_kb_search
  on public.gdpr_kb using gin (search_vector);

create index if not exists idx_gdpr_kb_category
  on public.gdpr_kb(category);

-- ---------------------------------------------------------------------------
-- Extracted document text cache (token-optimization layer)
-- ---------------------------------------------------------------------------

create table if not exists public.document_extracts (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  content_hash text not null,
  extracted_text text not null,
  token_estimate integer,
  created_at timestamptz not null default now(),
  unique(document_version_id, content_hash)
);

create index if not exists idx_document_extracts_version
  on public.document_extracts(document_version_id);
