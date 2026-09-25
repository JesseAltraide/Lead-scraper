-- Real bug found in manual testing: a run finished with `finish_run` claiming
-- "all candidates have been pulled and processed" while 9 of 19 discovered
-- candidates were still sitting at `queued` (screened as eligible, never
-- scraped) — scrape budget was barely touched (3/12 used). complete_run had
-- no check for this at all: it only verifies qualified leads have their four
-- drafts, so a run can complete_run/finish_run successfully while candidates
-- it already paid to discover (and, for `queued` ones, already screened) are
-- left un-worked with budget still available to work them.
--
-- `discovered` candidates haven't even been screened yet, and screening is
-- FREE (no scrape spent) per the agent's own instructions in runAgent.ts — so
-- there's never a legitimate reason to finish with tool-call budget left and
-- unscreened candidates sitting there. Guard on tool-call budget specifically
-- (not scrape budget): screening never costs a scrape, only a tool call.
--
-- This raises the same way INCOMPLETE_DRAFTS already does — a refusal the
-- agent's system prompt already tells it to read, adapt to, and continue
-- from, not a dead end for the user.
--
-- NOTE: this version was superseded by 0011_scrape_budget_split.sql the same
-- day it was applied — the check below conflates tool-call and scrape budget
-- for `queued` candidates. Kept as-is (not edited) because it was already
-- applied to the live database before the bug was found in review; editing a
-- migration file after it's been run makes the file lie about what's
-- actually in the database. See 0011 for the fix and the full explanation.

create or replace function complete_run(p_run_id uuid, p_stopping_reason text)
returns runs language plpgsql security definer as $$
declare r runs; n_qualified int; n_missing_drafts int; n_unprocessed int; final run_status;
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

  -- Candidates not yet screened (`discovered`) or screened-in but never
  -- scraped (`queued`), while tool-call budget remains to work them.
  select count(*) into n_unprocessed
    from candidates
   where run_id = p_run_id and stage in ('discovered', 'queued');

  if n_unprocessed > 0 and r.tool_calls_used < r.max_tool_calls then
    raise exception 'UNPROCESSED_CANDIDATES: % candidate(s) still discovered/queued with tool-call budget remaining (% of % used)',
      n_unprocessed, r.tool_calls_used, r.max_tool_calls
      using errcode = 'check_violation';
  end if;
  -- (superseded below by 0011 — see note above)

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
-- Live activity signal. wrapTool (agent/src/logging.ts) sets this to the tool
-- name at the start of every call and clears it in a finally block, so the
-- run row itself — already polled by the UI — carries "what is happening
-- right now" without a second table or a second poll.
--
-- Two UI uses: disable the Stop button while a website is being read
-- (active_tool = 'scrape_website'), and show a drafting spinner while copy is
-- being written (active_tool = 'save_outreach_draft').
-- ---------------------------------------------------------------------------

alter table runs add column if not exists active_tool text;
