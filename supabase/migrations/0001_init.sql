-- Week 5 — AI Lead Research & Outreach Agent
-- Schema. Invariants are enforced here (constraints, partial unique indexes,
-- derived status) rather than by convention in application code.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Every status here must have a row in the run-states table in week5-full-flow.md.
-- A status is not "built" until it has a defined screen and a defined next action.
create type run_status as enum (
  'refining',
  'awaiting_clarification',
  'icp_ready',
  'researching',
  'completed',
  'completed_partial',
  'failed',
  'cancelled'
);

create type candidate_stage as enum (
  'discovered',          -- returned by Apify, not yet screened
  'excluded_no_website', -- dropped at discovery: no domain, never scraped, never counted
  'screened_out',        -- clearly fails a hard filter on search data alone; no scrape spent
  'queued',              -- passed search-data screen, eligible to scrape
  'scraped',             -- website read successfully
  'scrape_failed',       -- scrape attempted, empty/failed result
  'qualified_done'       -- a lead record exists for this candidate
);

create type lead_status as enum ('qualified', 'not_qualified', 'needs_review');

create type filter_verdict as enum ('confirmed', 'failed', 'unknown');

create type draft_piece_key as enum ('email_1', 'email_2', 'email_3', 'linkedin');

create type draft_origin as enum ('initial', 'rewrite', 'edit');

create type tool_call_status as enum ('ok', 'refused', 'error');

-- ---------------------------------------------------------------------------
-- runs
-- ---------------------------------------------------------------------------

create table runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  status run_status not null default 'refining',

  -- The raw submitted form (Phase 1 Step 1). Kept verbatim so the review screen
  -- can show what the user actually typed vs what the clarity check normalised.
  form jsonb not null,

  -- The finalised ICP. NULL until save_icp runs. discover_companies gates on this
  -- being non-null *at call time*, not on "phase 1 probably finished".
  icp jsonb,
  icp_finalized_at timestamptz,

  -- Clarification loop (max 3 rounds).
  clarification_rounds int not null default 0,
  pending_questions jsonb,

  -- Limits. Read by the tools from here — never from agent input.
  max_candidates int not null,
  max_scrapes int not null,
  max_tool_calls int not null,
  max_agent_turns int not null,
  target_leads int not null,

  -- Run-wide counters. Incremented inside the same atomic write as the work.
  candidates_pulled int not null default 0,
  scrapes_used int not null default 0,
  tool_calls_used int not null default 0,

  -- Why the run stopped, in plain language, for completed_partial / failed.
  stopping_reason text,
  failure_reason text,
  failed_step text,

  -- Liveness. The sweep reclaims runs silent for N minutes rather than relying
  -- on a human noticing. A stale heartbeat is NOT itself proof of failure.
  heartbeat_at timestamptz,
  claimed_at timestamptz,
  claimed_by text,

  total_cost_usd numeric(10, 6) not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint runs_limits_positive check (
    max_candidates > 0 and max_scrapes > 0 and max_tool_calls > 0
    and max_agent_turns > 0 and target_leads between 1 and 10
  ),
  constraint runs_counters_nonneg check (
    candidates_pulled >= 0 and scrapes_used >= 0 and tool_calls_used >= 0
  ),
  constraint runs_clarification_cap check (clarification_rounds between 0 and 3)
);

-- One active run per user. Enforced as an index so two concurrent submits
-- cannot both win, rather than as a read-then-write check in application code.
create unique index runs_one_active_per_user
  on runs (user_id)
  where status in ('refining', 'awaiting_clarification', 'icp_ready', 'researching');

create index runs_user_created on runs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- run_events — append-only. Every failure writes a row with a reason, and the
-- UI reads the reason from here instead of inferring it from a status code.
-- ---------------------------------------------------------------------------

create table run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  kind text not null,              -- 'status_change' | 'failure' | 'note' | 'sweep_reclaim'
  status_from run_status,
  status_to run_status,
  reason text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index run_events_run_created on run_events (run_id, created_at);

-- ---------------------------------------------------------------------------
-- candidates — every company discovery returned, including the ones dropped.
-- The review screen shows excluded/screened-out companies with their reason,
-- so the reviewer sees what the agent discarded, not only what it kept.
-- ---------------------------------------------------------------------------

create table candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,

  company_name text not null,
  domain text,
  domain_normalized text,          -- null only when the company has no website

  employee_count int,
  location text,
  industry text,
  description text,
  search_raw jsonb not null default '{}'::jsonb,  -- everything the actor returned

  stage candidate_stage not null default 'discovered',
  stage_reason text,               -- why excluded / screened out / scrape failed

  scraped_urls text[] not null default '{}',
  scrape_summary text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dedupe by normalised domain within a run, backed by the database rather than
-- by the agent remembering. Companies with no website are exempt (null domain).
create unique index candidates_run_domain_unique
  on candidates (run_id, domain_normalized)
  where domain_normalized is not null;

create index candidates_run_created on candidates (run_id, created_at);

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------

create table leads (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,

  company_name text not null,
  domain text not null,
  domain_normalized text not null,

  -- Derived by save_lead_qualification() from lead_filter_results. Never taken
  -- from the agent's own summary of how it feels about the lead.
  status lead_status not null,

  confidence int not null,
  confidence_basis text not null,  -- why that number, in terms of evidence strength

  fit_reasons text[] not null default '{}',
  concerns text[] not null default '{}',
  source_urls text[] not null default '{}',
  source_summary text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leads_confidence_range check (confidence between 0 and 100),
  -- A lead with no domain or no evidence can never be qualified.
  constraint leads_qualified_needs_evidence check (
    status <> 'qualified'
    or (array_length(source_urls, 1) >= 1 and length(trim(source_summary)) > 0)
  )
);

create unique index leads_run_domain_unique on leads (run_id, domain_normalized);
create unique index leads_candidate_unique on leads (candidate_id);
create index leads_run_status on leads (run_id, status);

-- ---------------------------------------------------------------------------
-- lead_filter_results — per-hard-filter evidence. This is the real verdict;
-- leads.status is derived from it.
-- ---------------------------------------------------------------------------

create table lead_filter_results (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  filter_key text not null,        -- 'industry' | 'geography' | 'company_size' | 'must_have:<n>'
  filter_text text not null,       -- the requirement as the user stated it
  verdict filter_verdict not null,
  evidence text,                   -- the quoted/paraphrased source text
  evidence_source_url text,
  -- 'direct'   = the source text states it outright
  -- 'inferred' = concluded from surrounding context
  -- 'none'     = verdict is unknown, so there is nothing to grade
  -- Feeds the confidence formula, which is computed in code from these rows
  -- rather than chosen by the agent.
  evidence_kind text not null default 'none'
    check (evidence_kind in ('direct', 'inferred', 'none')),
  created_at timestamptz not null default now(),

  -- confirmed/failed must carry evidence; unknown is the state for "no evidence".
  constraint filter_verdict_needs_evidence check (
    verdict = 'unknown' or (evidence is not null and length(trim(evidence)) > 0)
  )
);

create unique index lead_filter_unique on lead_filter_results (lead_id, filter_key);

-- ---------------------------------------------------------------------------
-- draft_pieces / draft_versions
-- ---------------------------------------------------------------------------

create table draft_pieces (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  piece_key draft_piece_key not null,

  -- Counts rewrites actually requested, not a proxy like a version number.
  -- The rewrite endpoint claims a slot here before calling Claude and releases
  -- it if the call fails, so a double-click cannot fire two paid calls.
  rewrites_requested int not null default 0,
  rewrite_in_flight boolean not null default false,

  created_at timestamptz not null default now(),

  constraint rewrites_capped check (rewrites_requested between 0 and 3)
);

create unique index draft_pieces_unique on draft_pieces (lead_id, piece_key);

create table draft_versions (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null references draft_pieces(id) on delete cascade,

  subject text,                    -- email steps only; null for linkedin
  body text not null,
  personalization_note text not null,

  -- Every personalization note must cite what it is based on. Checked in code
  -- after generation *and* after every rewrite, then required here.
  citation_source_url text,
  citation_fact text not null,

  origin draft_origin not null,
  rewrite_note text,               -- required when origin = 'rewrite'

  is_chosen boolean not null default false,
  reviewed boolean not null default false,

  created_at timestamptz not null default now(),

  constraint rewrite_needs_note check (
    origin <> 'rewrite' or (rewrite_note is not null and length(trim(rewrite_note)) > 0)
  ),
  constraint citation_nonempty check (length(trim(citation_fact)) > 0)
);

-- "Exactly one chosen version per piece" as an impossibility, not a convention.
create unique index draft_versions_one_chosen
  on draft_versions (piece_id)
  where is_chosen;

-- Ordering is by created_at + id. There is deliberately no version number
-- column: per-run numbers that restart caused repeated bugs in a prior build.
create index draft_versions_piece_created on draft_versions (piece_id, created_at, id);

-- ---------------------------------------------------------------------------
-- tool_calls — append-only, written by the wrapper on every call, never by the
-- agent choosing to log.
-- ---------------------------------------------------------------------------

create table tool_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  tool_name text not null,
  purpose text,
  input_summary text,
  result_summary text,
  status tool_call_status not null,
  error_message text,
  duration_ms int,
  created_at timestamptz not null default now()
);

create index tool_calls_run_created on tool_calls (run_id, created_at);

-- ---------------------------------------------------------------------------
-- Dev caches — pay once per query, reuse while iterating. These also double as
-- the recovery mechanism: a retry re-reads cached scrapes instead of re-paying.
-- Not scoped to a run, deliberately.
-- ---------------------------------------------------------------------------

create table apify_cache (
  query_hash text primary key,
  query jsonb not null,
  results jsonb not null,
  created_at timestamptz not null default now()
);

create table firecrawl_cache (
  url_normalized text primary key,
  content text not null,
  content_length int not null,
  ok boolean not null,             -- false for near-empty results (JS shell, cookie wall)
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger runs_touch before update on runs
  for each row execute function touch_updated_at();
create trigger candidates_touch before update on candidates
  for each row execute function touch_updated_at();
create trigger leads_touch before update on leads
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security. The agent server uses the service role key and bypasses
-- these; the browser client does not.
-- ---------------------------------------------------------------------------

alter table runs enable row level security;
alter table run_events enable row level security;
alter table candidates enable row level security;
alter table leads enable row level security;
alter table lead_filter_results enable row level security;
alter table draft_pieces enable row level security;
alter table draft_versions enable row level security;
alter table tool_calls enable row level security;

create policy runs_owner on runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy run_events_owner on run_events for select
  using (exists (select 1 from runs r where r.id = run_id and r.user_id = auth.uid()));
create policy candidates_owner on candidates for select
  using (exists (select 1 from runs r where r.id = run_id and r.user_id = auth.uid()));
create policy leads_owner on leads for select
  using (exists (select 1 from runs r where r.id = run_id and r.user_id = auth.uid()));
create policy tool_calls_owner on tool_calls for select
  using (exists (select 1 from runs r where r.id = run_id and r.user_id = auth.uid()));
create policy lead_filter_owner on lead_filter_results for select
  using (exists (
    select 1 from leads l join runs r on r.id = l.run_id
    where l.id = lead_id and r.user_id = auth.uid()));
create policy draft_pieces_owner on draft_pieces for select
  using (exists (
    select 1 from leads l join runs r on r.id = l.run_id
    where l.id = lead_id and r.user_id = auth.uid()));
create policy draft_versions_owner on draft_versions for select
  using (exists (
    select 1 from draft_pieces p join leads l on l.id = p.lead_id
    join runs r on r.id = l.run_id
    where p.id = piece_id and r.user_id = auth.uid()));
