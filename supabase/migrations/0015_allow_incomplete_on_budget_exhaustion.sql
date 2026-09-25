-- Real user-reported bug: when the agent runs out of turns/tool-calls mid
-- run (some qualified leads still missing drafts, or candidates still
-- unprocessed with technically-remaining budget), runAgent.ts's own
-- auto-complete path called complete_run, which refused with
-- INCOMPLETE_DRAFTS or UNPROCESSED_CANDIDATES exactly as it should for the
-- agent's own voluntary finish_run call. But that refusal fell through to
-- fail_run, landing the run on `failed` with only Retry/Review-and-continue
-- offered, and "Review and continue" (start_over) sends the user back to the
-- ICP confirm screen, not to their leads, even though real, reviewable work
-- (qualified leads, partial drafts) already existed.
--
-- Fix: a new p_allow_incomplete flag, true only from runAgent.ts's own
-- auto-complete call (genuine budget/turn exhaustion), false everywhere else
-- (the agent's own finish_run tool call still must not choose to call itself
-- done with drafts missing or candidates unprocessed while it could still
-- act on them, that discipline is unchanged). When true and something is
-- genuinely incomplete, the run lands honestly on completed/completed_partial
-- with a clear note about what's still missing, so Review and Export both
-- work right away instead of routing through a `failed` dead end.

create or replace function complete_run(
  p_run_id uuid,
  p_stopping_reason text,
  p_allow_incomplete boolean default false
)
returns runs language plpgsql security definer as $$
declare
  r runs;
  n_qualified int;
  n_missing_drafts int;
  n_unscreened int;
  n_unscraped int;
  final run_status;
  -- coalesce, not a bare assignment: text || null returns null in Postgres,
  -- which would silently drop the appended incomplete-work note below (and
  -- leave stopping_reason null on the partial-completion path). Not reachable
  -- today (both current callers always pass a non-empty string), but a future
  -- caller without that same guarantee should not be able to lose this.
  reason text := coalesce(p_stopping_reason, '');
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

  if n_missing_drafts > 0 and not p_allow_incomplete then
    raise exception 'INCOMPLETE_DRAFTS: % qualified lead(s) are missing drafts', n_missing_drafts
      using errcode = 'check_violation';
  end if;

  -- `discovered`: not yet screened. Screening is free (a tool call, not a
  -- scrape), so gate on tool-call budget.
  select count(*) into n_unscreened
    from candidates where run_id = p_run_id and stage = 'discovered';

  -- `queued`: already screened, only needs a scrape. Gate on scrape budget,
  -- not tool-call budget.
  select count(*) into n_unscraped
    from candidates where run_id = p_run_id and stage = 'queued';

  if not p_allow_incomplete
     and ((n_unscreened > 0 and r.tool_calls_used < r.max_tool_calls)
          or (n_unscraped > 0 and r.scrapes_used < r.max_scrapes)) then
    raise exception 'UNPROCESSED_CANDIDATES: % unscreened, % unscraped, with budget remaining (tool calls % of %, scrapes % of %)',
      n_unscreened, n_unscraped, r.tool_calls_used, r.max_tool_calls, r.scrapes_used, r.max_scrapes
      using errcode = 'check_violation';
  end if;

  if p_allow_incomplete and (n_missing_drafts > 0 or n_unscreened > 0 or n_unscraped > 0) then
    reason := reason || format(
      ' %s qualified lead(s) missing drafts, %s candidate(s) never screened, %s never scraped, budget ran out first.',
      n_missing_drafts, n_unscreened, n_unscraped
    );
  end if;

  final := case when n_qualified >= r.target_leads then 'completed'
                else 'completed_partial' end;

  update runs
     set status = final,
         stopping_reason = reason
   where id = p_run_id returning * into r;

  insert into run_events (run_id, kind, status_from, status_to, reason, detail)
  values (p_run_id, 'status_change', 'researching', final, reason,
          jsonb_build_object('qualified', n_qualified, 'target', r.target_leads));

  return r;
end $$;
