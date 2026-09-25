-- Fixes a real bug in 0010's UNPROCESSED_CANDIDATES guard, caught in code
-- review before it caused harm in practice: it gated BOTH `discovered` and
-- `queued` candidates on tool-call budget alone. `discovered` candidates need
-- screening, which is free (costs a tool call, not a scrape), so that gate is
-- right for them. But `queued` candidates are already screened and only need
-- a scrape, which is gated on SCRAPE budget (see claim_scrape_budget in
-- 0002_guards.sql), not tool-call budget.
--
-- Concrete failure this caused: with scrapes exhausted but tool-call budget
-- still open, complete_run refused to finish over `queued` candidates that
-- can never be scraped again. The agent's system prompt tells it to read a
-- refusal and continue, so it would keep attempting to scrape those
-- candidates purely to burn through the remaining tool-call budget before
-- complete_run would finally allow the run to finish, wasted retries and
-- latency, not a permanent dead end, but not the intended behavior either.
--
-- Fix: split the count by stage and check each against its own budget.

create or replace function complete_run(p_run_id uuid, p_stopping_reason text)
returns runs language plpgsql security definer as $$
declare
  r runs;
  n_qualified int;
  n_missing_drafts int;
  n_unscreened int;
  n_unscraped int;
  final run_status;
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

  -- `discovered`: not yet screened. Screening is free (a tool call, not a
  -- scrape), so gate on tool-call budget.
  select count(*) into n_unscreened
    from candidates where run_id = p_run_id and stage = 'discovered';

  -- `queued`: already screened, only needs a scrape. Gate on scrape budget,
  -- not tool-call budget. This is the fix over 0010.
  select count(*) into n_unscraped
    from candidates where run_id = p_run_id and stage = 'queued';

  if (n_unscreened > 0 and r.tool_calls_used < r.max_tool_calls)
     or (n_unscraped > 0 and r.scrapes_used < r.max_scrapes) then
    raise exception 'UNPROCESSED_CANDIDATES: % unscreened, % unscraped, with budget remaining (tool calls % of %, scrapes % of %)',
      n_unscreened, n_unscraped, r.tool_calls_used, r.max_tool_calls, r.scrapes_used, r.max_scrapes
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
