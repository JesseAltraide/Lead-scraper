-- Decision #57's promised fix: a real record of what users typed that a fixed
-- taxonomy (industry, and geography if it ever needs the same treatment)
-- rejected, so the ALIASES tables can grow from observed misses instead of
-- guessing in advance.
--
-- Deliberately a REPORT queue, not a live alias store the app reads from.
-- industries.ts/geography.ts stay static and checked into the codebase, same
-- as every other taxonomy check in this project — a report here informs a
-- human edit to that file, it never silently changes what the next user's
-- search sees. One person's click is a data point, not an authority.

create table taxonomy_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  field text not null check (field in ('industry', 'geography')),

  -- Exactly what the user typed. Never modified after insert — the whole
  -- point is an unedited record of real input.
  raw_input text not null,

  -- What the code suggested, if anything. This flow only exists at all when
  -- suggestions were non-empty (the "not just gibberish" rule the user
  -- specifically asked for) — a report with no suggestions offered would mean
  -- the caller bypassed that rule.
  suggestions_shown text[] not null check (array_length(suggestions_shown, 1) >= 1),

  -- Which one (if any) the user says was actually right. Null means "none of
  -- these were it" — still a useful signal, just without a candidate mapping.
  chosen_label text,

  reviewed boolean not null default false,
  created_at timestamptz not null default now()
);

create index taxonomy_reports_unreviewed on taxonomy_reports (field, created_at)
  where not reviewed;

-- A user can see and create their own reports, nothing else — this is
-- diagnostic data for whoever maintains the taxonomy, not a per-user record
-- they need to manage.
alter table taxonomy_reports enable row level security;

create policy taxonomy_reports_insert_own on taxonomy_reports
  for insert with check (user_id = auth.uid());

create policy taxonomy_reports_select_own on taxonomy_reports
  for select using (user_id = auth.uid());
