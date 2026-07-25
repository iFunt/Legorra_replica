-- PrivacyDrift Analyzer schema
-- Compares a company's stated privacy policy against the actual
-- data-harvesting behavior of its website. See:
--   privacy_scans        — one row per scan run against a domain
--   policy_commitments   — the "stated" data (LLM-extracted from the policy)
--   technical_evidence   — the "actual" data (captured by the headless scanner)
--   discrepancy_flags    — evidence that contradicts a commitment

create table if not exists public.privacy_scans (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project_id uuid references public.projects(id) on delete set null,
  domain text not null,
  status text not null default 'pending'
    check (status = any (array[
      'pending'::text,
      'discovering'::text,
      'scanning'::text,
      'analyzing'::text,
      'ready'::text,
      'error'::text
    ])),
  error_message text,
  privacy_policy_url text,
  terms_url text,
  cookie_banner_detected boolean,
  scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_privacy_scans_user
  on public.privacy_scans(user_id, created_at desc);

create index if not exists idx_privacy_scans_domain
  on public.privacy_scans(domain);

create table if not exists public.policy_commitments (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.privacy_scans(id) on delete cascade,
  domain text not null,
  clause_type text not null
    check (clause_type = any (array[
      'TRACKING'::text,
      'SHARING'::text,
      'RETENTION'::text,
      'BIOMETRIC'::text,
      'CONSENT'::text,
      'SECURITY'::text,
      'OTHER'::text
    ])),
  extracted_text text not null,
  rule_key text not null,
  machine_rule boolean not null,
  source_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_policy_commitments_scan
  on public.policy_commitments(scan_id);

create table if not exists public.technical_evidence (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.privacy_scans(id) on delete cascade,
  domain text not null,
  consent_state text not null
    check (consent_state = any (array['ACCEPTED'::text, 'REJECTED'::text, 'NONE'::text])),
  tracker_domain text not null,
  tracker_owner text,
  tracker_category text,
  payload_type text not null
    check (payload_type = any (array[
      'COOKIE'::text,
      'PIXEL'::text,
      'API_POST'::text,
      'LOCAL_STORAGE'::text,
      'WEBSOCKET'::text
    ])),
  data_transmitted text,
  request_url text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_technical_evidence_scan
  on public.technical_evidence(scan_id);

create index if not exists idx_technical_evidence_tracker
  on public.technical_evidence(tracker_domain);

create table if not exists public.discrepancy_flags (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.privacy_scans(id) on delete cascade,
  domain text not null,
  severity text not null check (severity = any (array['HIGH'::text, 'MEDIUM'::text, 'LOW'::text])),
  regulatory_flags text[] not null default array[]::text[],
  violation_summary text not null,
  evidence_id uuid references public.technical_evidence(id) on delete cascade,
  commitment_id uuid references public.policy_commitments(id) on delete set null,
  potential_claim_value integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_discrepancy_flags_scan
  on public.discrepancy_flags(scan_id);

alter table public.privacy_scans enable row level security;
alter table public.policy_commitments enable row level security;
alter table public.technical_evidence enable row level security;
alter table public.discrepancy_flags enable row level security;

drop policy if exists "Users manage their own scans" on public.privacy_scans;
create policy "Users manage their own scans"
  on public.privacy_scans for all
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

drop policy if exists "Users read commitments for their scans" on public.policy_commitments;
create policy "Users read commitments for their scans"
  on public.policy_commitments for select
  using (exists (
    select 1 from public.privacy_scans s
    where s.id = scan_id and s.user_id = auth.uid()::text
  ));

drop policy if exists "Users read evidence for their scans" on public.technical_evidence;
create policy "Users read evidence for their scans"
  on public.technical_evidence for select
  using (exists (
    select 1 from public.privacy_scans s
    where s.id = scan_id and s.user_id = auth.uid()::text
  ));

drop policy if exists "Users read flags for their scans" on public.discrepancy_flags;
create policy "Users read flags for their scans"
  on public.discrepancy_flags for select
  using (exists (
    select 1 from public.privacy_scans s
    where s.id = scan_id and s.user_id = auth.uid()::text
  ));
