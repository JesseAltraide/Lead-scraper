-- Real deadlock found while reviewing 0017/0018's new guards against a
-- Claude/agent-SDK crash mid-run: if the process dies while a candidate is
-- mid-scrape, that candidate is left at stage='scraping' indefinitely.
-- scrape_website's own claim query (0003/0006/0007) already knows how to
-- reclaim a stage='scraping' row after a 10-minute staleness window, BUT
-- that reclaim only runs the next time scrape_website is actually CALLED for
-- that candidate — and runAgent.ts's own resume prompt explicitly tells the
-- agent "Do not re-discover, re-screen or re-scrape anything already
-- listed", listing that candidate's real stage as 'scraping'. The resumed
-- agent reads that as "someone is already handling this" and skips it
-- forever.
--
-- Combined with 0017 (blocks qualifying while any candidate is unscraped)
-- and 0018 (blocks drafting the same way), this candidate being permanently
-- skipped means those guards refuse forever with budget still nominally
-- remaining — a real deadlock, not a transient refusal, introduced by 0017/
-- 0018 tightening the rules around exactly this pre-existing gap.
--
-- Fix: claim_run_for_research (called once at the start of every run AND
-- every retry, before the agent ever sees a prompt) resets any of ITS OWN
-- run's candidates still sitting at 'scraping' back to 'queued'. Safe
-- specifically because this run is single-worker and sequential — if we are
-- claiming it out of icp_ready, whatever process was scraping on its behalf
-- before is provably gone, not concurrently still working. By the time
-- buildPrompt reads the candidates table, the stage already reads 'queued',
-- so the existing resume instructions ("don't redo anything listed") are
-- correct as written rather than needing a special case for 'scraping'.
--
-- Also refunds scrapes_used for each one reset, same reasoning as 0014's
-- release_scrape_claim: claim_scrape_budget spends the slot at CLAIM time,
-- not completion, so an attempt that died mid-scrape already spent a slot on
-- nothing. Without this, resuming and re-scraping the same candidate would
-- charge the run's limited budget twice for one real read.

create or replace function claim_run_for_research(p_run_id uuid, p_worker text)
returns runs language plpgsql security definer as $$
declare r runs; n_reclaimed int;
begin
  update runs
     set status = 'researching',
         claimed_at = now(),
         claimed_by = p_worker,
         heartbeat_at = now(),
         active_tool = null
   where id = p_run_id
     and status = 'icp_ready'      -- guard on state, not on time
     and icp is not null           -- discovery requires a finalised ICP right now
   returning * into r;

  if r.id is null then
    raise exception 'RUN_NOT_CLAIMABLE: run % is not in icp_ready with a finalised ICP', p_run_id
      using errcode = 'check_violation';
  end if;

  -- Whatever was mid-scrape belonged to the process that just failed (or,
  -- for a first-ever claim, there is nothing to reset) — never a process
  -- still running concurrently, since a run only has one worker at a time.
  with reset as (
    update candidates
       set stage = 'queued', scrape_claimed_at = null
     where run_id = p_run_id and stage = 'scraping'
    returning 1
  )
  select count(*) into n_reclaimed from reset;

  if n_reclaimed > 0 then
    -- Re-selected into r: the row returned to the caller must reflect the
    -- refund too, not the pre-refund scrapes_used from the update above.
    update runs set scrapes_used = greatest(0, scrapes_used - n_reclaimed)
     where id = p_run_id
    returning * into r;
  end if;

  insert into run_events (run_id, kind, status_to, reason)
  values (p_run_id, 'status_change', 'researching', 'claimed by ' || p_worker);

  return r;
end $$;
