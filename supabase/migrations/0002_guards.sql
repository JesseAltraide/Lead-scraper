-- Week 5 — atomic guards.
--
-- Every gate below checks the CURRENT ACTUAL STATE of the record inside the same
-- write that does the work — never "this step probably already happened".
-- These run as SECURITY DEFINER and are called by the agent server only.

-- ---------------------------------------------------------------------------
-- claim_run — claim a run for research. A conditional update: two overlapping
-- start requests cannot both win, because only one sees a row come back.
-- ---------------------------------------------------------------------------

create or replace function claim_run_for_research(p_run_id uuid, p_worker text)
returns runs language plpgsql security definer as $$
declare r runs;
begin
  update runs
     set status = 'researching',
         claimed_at = now(),
         claimed_by = p_worker,
         heartbeat_at = now()
   where id = p_run_id
     and status = 'icp_ready'      -- guard on state, not on time
     and icp is not null           -- discovery requires a finalised ICP right now
   returning * into r;

  if r.id is null then
    raise exception 'RUN_NOT_CLAIMABLE: run % is not in icp_ready with a finalised ICP', p_run_id
      using errcode = 'check_violation';
  end if;

  insert into run_events (run_id, kind, status_to, reason)
  values (p_run_id, 'status_change', 'researching', 'claimed by ' || p_worker);

  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Budget claims. The count is incremented in the same statement that checks it,
-- so N concurrent calls can never collectively exceed the cap.
-- The limit is read from the run record. Agent input cannot raise it.
-- ---------------------------------------------------------------------------

-- Returns how many candidates the caller may actually request. The row is locked
-- FOR UPDATE, so two concurrent discovery calls cannot both read the same headroom.
create or replace function claim_candidate_budget(p_run_id uuid, p_requested int)
returns int language plpgsql security definer as $$
declare before_count int; cap int; granted int;
begin
  select candidates_pulled, max_candidates into before_count, cap
    from runs where id = p_run_id and status = 'researching' and icp is not null
    for update;

  if cap is null then
    raise exception 'RUN_NOT_RESEARCHING: run % cannot discover right now', p_run_id
      using errcode = 'check_violation';
  end if;

  granted := least(greatest(p_requested, 0), cap - before_count);

  if granted <= 0 then
    raise exception 'CANDIDATE_CAP_REACHED: %/% candidates already pulled', before_count, cap
      using errcode = 'check_violation';
  end if;

  update runs set candidates_pulled = candidates_pulled + granted where id = p_run_id;
  return granted;
end $$;

create or replace function claim_scrape_budget(p_run_id uuid, p_candidate_id uuid)
returns candidates language plpgsql security definer as $$
declare c candidates; used int; cap int;
begin
  select scrapes_used, max_scrapes into used, cap
    from runs where id = p_run_id and status = 'researching' for update;

  if cap is null then
    raise exception 'RUN_NOT_RESEARCHING: run % cannot scrape right now', p_run_id
      using errcode = 'check_violation';
  end if;

  if used >= cap then
    raise exception 'SCRAPE_CAP_REACHED: %/% scrapes already used', used, cap
      using errcode = 'check_violation';
  end if;

  -- Only a candidate of THIS run that passed the search-data screen may be
  -- scraped. A scraped page cannot point the agent at some other domain,
  -- and a screened-out candidate cannot be revisited.
  select * into c from candidates
   where id = p_candidate_id and run_id = p_run_id and stage = 'queued'
   for update;

  if c.id is null then
    raise exception 'CANDIDATE_NOT_SCRAPEABLE: % is not a queued candidate of run %',
      p_candidate_id, p_run_id using errcode = 'check_violation';
  end if;

  update runs set scrapes_used = scrapes_used + 1 where id = p_run_id;
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- save_lead_qualification — status is DERIVED here from the per-filter
-- evidence. The agent's claimed status is accepted only if it matches; a
-- mismatch is rejected outright.
--
-- p_filters: [{ filter_key, filter_text, verdict, evidence, evidence_source_url }]
-- ---------------------------------------------------------------------------

create or replace function save_lead_qualification(
  p_run_id uuid,
  p_candidate_id uuid,
  p_claimed_status lead_status,
  p_confidence int,
  p_confidence_basis text,
  p_fit_reasons text[],
  p_concerns text[],
  p_source_urls text[],
  p_source_summary text,
  p_filters jsonb
) returns leads language plpgsql security definer as $$
declare
  c candidates;
  l leads;
  n_failed int;
  n_unknown int;
  n_total int;
  derived lead_status;
  f jsonb;
begin
  if jsonb_typeof(p_filters) <> 'array' or jsonb_array_length(p_filters) = 0 then
    raise exception 'NO_FILTER_EVIDENCE: at least one hard filter result is required'
      using errcode = 'check_violation';
  end if;

  select * into c from candidates
   where id = p_candidate_id and run_id = p_run_id for update;

  if c.id is null then
    raise exception 'CANDIDATE_NOT_IN_RUN: % does not belong to run %', p_candidate_id, p_run_id
      using errcode = 'check_violation';
  end if;

  -- A company with no website can never reach qualification.
  if c.domain_normalized is null then
    raise exception 'NO_WEBSITE: candidate % has no domain and cannot be qualified', p_candidate_id
      using errcode = 'check_violation';
  end if;

  -- Derive the status from the evidence, exactly as specified:
  --   any hard filter failed  -> not_qualified
  --   all confirmed           -> qualified
  --   otherwise (any unknown) -> needs_review
  select
    count(*) filter (where e->>'verdict' = 'failed'),
    count(*) filter (where e->>'verdict' = 'unknown'),
    count(*)
  into n_failed, n_unknown, n_total
  from jsonb_array_elements(p_filters) e;

  if n_failed > 0 then
    derived := 'not_qualified';
  elsif n_unknown > 0 then
    derived := 'needs_review';
  else
    derived := 'qualified';
  end if;

  if p_claimed_status is distinct from derived then
    raise exception
      'STATUS_MISMATCH: claimed % but evidence gives % (% failed, % unknown of %)',
      p_claimed_status, derived, n_failed, n_unknown, n_total
      using errcode = 'check_violation';
  end if;

  insert into leads (
    run_id, candidate_id, company_name, domain, domain_normalized, status,
    confidence, confidence_basis, fit_reasons, concerns, source_urls, source_summary
  ) values (
    p_run_id, p_candidate_id, c.company_name, c.domain, c.domain_normalized, derived,
    p_confidence, p_confidence_basis, coalesce(p_fit_reasons, '{}'),
    coalesce(p_concerns, '{}'), coalesce(p_source_urls, '{}'), p_source_summary
  )
  returning * into l;

  for f in select * from jsonb_array_elements(p_filters) loop
    insert into lead_filter_results
      (lead_id, filter_key, filter_text, verdict, evidence, evidence_source_url, evidence_kind)
    values (
      l.id, f->>'filter_key', f->>'filter_text', (f->>'verdict')::filter_verdict,
      nullif(f->>'evidence', ''), nullif(f->>'evidence_source_url', ''),
      coalesce(nullif(f->>'evidence_kind', ''), 'none')
    );
  end loop;

  update candidates set stage = 'qualified_done' where id = p_candidate_id;

  return l;
end $$;

-- ---------------------------------------------------------------------------
-- save_outreach_draft — refuses any lead not `qualified` RIGHT NOW.
-- Clear-then-set on the chosen flag, because of the partial unique index.
-- ---------------------------------------------------------------------------

create or replace function save_outreach_draft(
  p_lead_id uuid,
  p_piece_key draft_piece_key,
  p_subject text,
  p_body text,
  p_personalization_note text,
  p_citation_source_url text,
  p_citation_fact text,
  p_origin draft_origin,
  p_rewrite_note text
) returns draft_versions language plpgsql security definer as $$
declare st lead_status; piece draft_pieces; v draft_versions;
begin
  select status into st from leads where id = p_lead_id for update;

  if st is null then
    raise exception 'LEAD_NOT_FOUND: %', p_lead_id using errcode = 'check_violation';
  end if;

  if st <> 'qualified' then
    raise exception 'LEAD_NOT_QUALIFIED: lead % is % — drafts are only for qualified leads',
      p_lead_id, st using errcode = 'check_violation';
  end if;

  insert into draft_pieces (lead_id, piece_key)
  values (p_lead_id, p_piece_key)
  on conflict (lead_id, piece_key) do update set lead_id = excluded.lead_id
  returning * into piece;

  -- Clear then set: never leave two rows momentarily chosen.
  update draft_versions set is_chosen = false where piece_id = piece.id and is_chosen;

  insert into draft_versions (
    piece_id, subject, body, personalization_note,
    citation_source_url, citation_fact, origin, rewrite_note, is_chosen, reviewed
  ) values (
    piece.id, p_subject, p_body, p_personalization_note,
    nullif(p_citation_source_url, ''), p_citation_fact, p_origin,
    nullif(p_rewrite_note, ''), true, false   -- newest becomes chosen, unreviewed
  )
  returning * into v;

  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Rewrite slot: claim before acting, release on failure. Cap counts rewrites
-- actually requested, not a proxy like a version number.
-- ---------------------------------------------------------------------------

create or replace function claim_rewrite_slot(p_lead_id uuid, p_piece_key draft_piece_key)
returns draft_pieces language plpgsql security definer as $$
declare piece draft_pieces;
begin
  insert into draft_pieces (lead_id, piece_key) values (p_lead_id, p_piece_key)
  on conflict (lead_id, piece_key) do update set lead_id = excluded.lead_id;

  update draft_pieces
     set rewrites_requested = rewrites_requested + 1,
         rewrite_in_flight = true
   where lead_id = p_lead_id
     and piece_key = p_piece_key
     and rewrites_requested < 3
     and rewrite_in_flight = false     -- a second click finds this true and no-ops
   returning * into piece;

  if piece.id is null then
    raise exception 'REWRITE_UNAVAILABLE: cap reached or a rewrite is already in flight'
      using errcode = 'check_violation';
  end if;

  return piece;
end $$;

-- Releasing a failed claim is mandatory: claiming and then failing without
-- releasing silently discards the slot forever.
create or replace function release_rewrite_slot(p_piece_id uuid, p_succeeded boolean)
returns void language plpgsql security definer as $$
begin
  update draft_pieces
     set rewrite_in_flight = false,
         rewrites_requested = case when p_succeeded
                                   then rewrites_requested
                                   else greatest(rewrites_requested - 1, 0) end
   where id = p_piece_id;
end $$;

-- ---------------------------------------------------------------------------
-- choose_draft_version — "reviewed" belongs to a specific version, so choosing
-- a different one resets it to unreviewed.
-- ---------------------------------------------------------------------------

create or replace function choose_draft_version(p_version_id uuid)
returns draft_versions language plpgsql security definer as $$
declare v draft_versions; p uuid;
begin
  select piece_id into p from draft_versions where id = p_version_id;
  if p is null then
    raise exception 'VERSION_NOT_FOUND: %', p_version_id using errcode = 'check_violation';
  end if;

  update draft_versions set is_chosen = false where piece_id = p and is_chosen;
  update draft_versions set is_chosen = true, reviewed = false
   where id = p_version_id returning * into v;

  return v;
end $$;

-- ---------------------------------------------------------------------------
-- complete_run — checks the run's REAL contents right now. A run that errored
-- halfway must never display or export as complete.
-- ---------------------------------------------------------------------------

create or replace function complete_run(p_run_id uuid, p_stopping_reason text)
returns runs language plpgsql security definer as $$
declare r runs; n_qualified int; n_missing_drafts int; final run_status;
begin
  select * into r from runs where id = p_run_id for update;
  if r.id is null then
    raise exception 'RUN_NOT_FOUND: %', p_run_id using errcode = 'check_violation';
  end if;
  if r.status <> 'researching' then
    raise exception 'RUN_NOT_RESEARCHING: % is %', p_run_id, r.status
      using errcode = 'check_violation';
  end if;

  -- needs_review leads never count toward the target.
  select count(*) into n_qualified
    from leads where run_id = p_run_id and status = 'qualified';

  -- Every qualified lead must actually have all four drafts.
  select count(*) into n_missing_drafts
    from leads l
   where l.run_id = p_run_id and l.status = 'qualified'
     and (select count(distinct p.piece_key) from draft_pieces p where p.lead_id = l.id) < 4;

  if n_missing_drafts > 0 then
    raise exception 'INCOMPLETE_DRAFTS: % qualified lead(s) are missing drafts', n_missing_drafts
      using errcode = 'check_violation';
  end if;

  final := case when n_qualified >= r.target_leads then 'completed'
                else 'completed_partial' end;

  update runs
     set status = final,
         stopping_reason = p_stopping_reason
   where id = p_run_id returning * into r;

  insert into run_events (run_id, kind, status_from, status_to, reason, detail)
  values (p_run_id, 'status_change', 'researching', final, p_stopping_reason,
          jsonb_build_object('qualified', n_qualified, 'target', r.target_leads));

  return r;
end $$;

-- ---------------------------------------------------------------------------
-- fail_run / sweep. A timeout is not automatically a failure — the sweep only
-- reclaims runs whose heartbeat is genuinely stale, and it records why.
-- ---------------------------------------------------------------------------

create or replace function fail_run(p_run_id uuid, p_step text, p_reason text)
returns runs language plpgsql security definer as $$
declare r runs;
begin
  update runs
     set status = 'failed', failed_step = p_step, failure_reason = p_reason
   where id = p_run_id and status = 'researching'
   returning * into r;

  if r.id is null then return null; end if;

  insert into run_events (run_id, kind, status_from, status_to, reason,
                          detail)
  values (p_run_id, 'failure', 'researching', 'failed', p_reason,
          jsonb_build_object('step', p_step));

  return r;
end $$;

create or replace function sweep_stalled_runs(p_stale_minutes int default 10)
returns setof runs language plpgsql security definer as $$
declare r runs;
begin
  for r in
    update runs
       set status = 'failed',
           failed_step = 'heartbeat',
           failure_reason = format('No progress reported for over %s minutes', p_stale_minutes)
     where status = 'researching'
       and heartbeat_at is not null
       and heartbeat_at < now() - make_interval(mins => p_stale_minutes)
    returning *
  loop
    insert into run_events (run_id, kind, status_from, status_to, reason)
    values (r.id, 'sweep_reclaim', 'researching', 'failed', r.failure_reason);
    return next r;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- claim_tool_call_budget — called by the logging wrapper on EVERY tool call,
-- before the tool runs. Counting and checking are the same statement.
-- ---------------------------------------------------------------------------

create or replace function claim_tool_call_budget(p_run_id uuid)
returns jsonb language plpgsql security definer as $$
declare used int; cap int;
begin
  update runs
     set tool_calls_used = tool_calls_used + 1
   where id = p_run_id
     and status = 'researching'
     and tool_calls_used < max_tool_calls
   returning tool_calls_used, max_tool_calls into used, cap;

  if used is null then
    select tool_calls_used, max_tool_calls, status into used, cap
      from runs where id = p_run_id;
    if used is null then
      raise exception 'RUN_NOT_FOUND: %', p_run_id using errcode = 'check_violation';
    end if;
    raise exception 'TOOL_CALL_CAP_REACHED: %/% tool calls used, or run is not researching', used, cap
      using errcode = 'check_violation';
  end if;

  return jsonb_build_object('used', used, 'cap', cap);
end $$;

-- ---------------------------------------------------------------------------
-- heartbeat — proof of life, so the sweep can tell "still running" from
-- "silently dead". A timeout on its own is not evidence of failure.
-- ---------------------------------------------------------------------------

create or replace function run_heartbeat(p_run_id uuid)
returns void language plpgsql security definer as $$
begin
  update runs set heartbeat_at = now()
   where id = p_run_id and status = 'researching';
end $$;
