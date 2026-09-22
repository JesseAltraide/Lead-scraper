-- Fixes a real double-spend found by scripts/attacks.ts.
--
-- Two concurrent claim_scrape_budget calls for the SAME candidate both
-- succeeded. The function locked the run row and checked the candidate was
-- `queued`, but nothing moved the candidate out of `queued` — that only
-- happened later, once the scrape returned. So both callers saw `queued`,
-- both incremented the run's scrape counter, and the same website was read
-- (and paid for) twice.
--
-- The counter check was never the problem. The missing piece was claiming the
-- ROW before acting on it, which is what actually makes a second overlapping
-- call a no-op.

-- `scraping` = claimed, in flight. ALTER TYPE ... ADD VALUE cannot be used in
-- the same transaction that adds it, so this runs as its own statement.
alter type candidate_stage add value if not exists 'scraping';

alter table candidates
  add column if not exists scrape_claimed_at timestamptz;

-- ---------------------------------------------------------------------------

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

  -- Claim the candidate BEFORE doing the work, as a conditional update. Two
  -- overlapping calls cannot both get a row back.
  --
  -- A stale claim is reclaimable: a run that died mid-scrape would otherwise
  -- strand its candidate in `scraping` forever, which is its own dead end.
  -- Ten minutes matches the run sweep.
  update candidates
     set stage = 'scraping',
         scrape_claimed_at = now()
   where id = p_candidate_id
     and run_id = p_run_id
     and (
       stage = 'queued'
       or (stage = 'scraping' and scrape_claimed_at < now() - interval '10 minutes')
     )
   returning * into c;

  if c.id is null then
    raise exception
      'CANDIDATE_NOT_SCRAPEABLE: % is not a queued candidate of run % (it may already be in flight, already read, or screened out)',
      p_candidate_id, p_run_id using errcode = 'check_violation';
  end if;

  update runs set scrapes_used = scrapes_used + 1 where id = p_run_id;
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Releasing the claim when the scrape fails to even start. Without this, a
-- crash between claiming and writing the result leaves the candidate in
-- `scraping` until the stale window passes.
-- ---------------------------------------------------------------------------

create or replace function release_scrape_claim(p_candidate_id uuid, p_reason text)
returns void language plpgsql security definer as $$
begin
  update candidates
     set stage = 'queued',
         scrape_claimed_at = null,
         stage_reason = p_reason
   where id = p_candidate_id and stage = 'scraping';
end $$;
