-- Real user-reported bug: mid-run, some candidates were already qualified
-- while others in the same run still sat at `queued` (not yet scraped). The
-- agent is free to interleave scrape_website and save_lead_qualification
-- calls across different candidates in whatever order it chooses — nothing
-- stopped it from reading company A, qualifying company A, reading company
-- B, qualifying company B, and so on, which is exactly how you end up with
-- some candidates qualified and others still unread partway through a run.
--
-- Fix: save_lead_qualification now refuses (not just complete_run, which
-- only checked this at the very end) while any candidate in the run still
-- needs screening or scraping and the budget to do so remains. Same
-- budget-aware split as complete_run's UNPROCESSED_CANDIDATES guard
-- (0010/0011) — screening is gated on tool-call budget, scraping on scrape
-- budget, and once a budget is actually exhausted the remaining unprocessed
-- candidates can never be processed, so qualifying what has been read is
-- correctly allowed to proceed rather than deadlocking the run.
--
-- save_outreach_draft needs no separate guard: a draft can only be written
-- for a lead, and a lead can only be created by save_lead_qualification, so
-- blocking qualification here already blocks every stage after it.

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
  n_unscreened int;
  n_unscraped int;
  r runs;
  derived lead_status;
  f jsonb;
begin
  if jsonb_typeof(p_filters) <> 'array' or jsonb_array_length(p_filters) = 0 then
    raise exception 'NO_FILTER_EVIDENCE: at least one hard filter result is required'
      using errcode = 'check_violation';
  end if;

  select * into r from runs where id = p_run_id for update;
  if r.id is null then
    raise exception 'RUN_NOT_FOUND: %', p_run_id using errcode = 'check_violation';
  end if;

  -- `discovered`: not yet screened. Screening is free (a tool call, not a
  -- scrape), so gate on tool-call budget.
  select count(*) into n_unscreened
    from candidates where run_id = p_run_id and stage = 'discovered';

  -- `queued`/`scraping`: already screened, only needs (or is mid-) a scrape.
  -- Gate on scrape budget, not tool-call budget.
  select count(*) into n_unscraped
    from candidates where run_id = p_run_id and stage in ('queued', 'scraping');

  if (n_unscreened > 0 and r.tool_calls_used < r.max_tool_calls)
     or (n_unscraped > 0 and r.scrapes_used < r.max_scrapes) then
    raise exception
      'UNPROCESSED_CANDIDATES: % unscreened, % unscraped, with budget remaining (tool calls % of %, scrapes % of %) — finish reading every candidate before qualifying any of them',
      n_unscreened, n_unscraped, r.tool_calls_used, r.max_tool_calls, r.scrapes_used, r.max_scrapes
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
