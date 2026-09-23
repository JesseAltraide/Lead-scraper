-- Fixes a real bug found via a forced-kill-and-resume test (see week5-progress.md
-- Errors & Fixes #9): firecrawl_cache genuinely has a candidate's scraped page
-- content, but claim_scrape_budget refused ANY re-call once a candidate's stage
-- moved past 'queued' -- including a candidate already at 'scraped'. A resumed
-- run could therefore never re-read its own already-cached evidence, and fell
-- back to weaker search-data-only qualification. Decision #8's cache exists
-- specifically so a resume is both cheap AND evidence-complete; this silently
-- defeated the "evidence-complete" half.
--
-- The fix adds an explicit URL to the claim call and re-serves a page for free,
-- with no new claim and no budget spend, ONLY when that exact URL is already in
-- the candidate's own scraped_urls -- i.e. genuinely no new Firecrawl call can
-- occur. Any other stage, or a URL not already read, is refused exactly as
-- before: this is still the actual security boundary (a candidate never
-- legitimately eligible to scrape stays refused).
create or replace function claim_scrape_budget(p_run_id uuid, p_candidate_id uuid, p_url text default null)
returns candidates language plpgsql security definer as $$
declare c candidates; used int; cap int;
begin
  select scrapes_used, max_scrapes into used, cap
    from runs where id = p_run_id and status = 'researching' for update;
  if cap is null then
    raise exception 'RUN_NOT_RESEARCHING: run % cannot scrape right now', p_run_id
      using errcode = 'check_violation';
  end if;

  -- Free re-read: this exact URL was already scraped for this candidate in this
  -- (or a prior, killed) session, so scrapeCached() will return the cache entry
  -- rather than calling Firecrawl. No new claim, no budget spend.
  if p_url is not null then
    select * into c from candidates
      where id = p_candidate_id and run_id = p_run_id
        and stage = 'scraped' and p_url = any(scraped_urls);
    if c.id is not null then
      return c;
    end if;
  end if;

  if used >= cap then
    raise exception 'SCRAPE_CAP_REACHED: %/% scrapes already used', used, cap
      using errcode = 'check_violation';
  end if;

  update candidates
     set stage = 'scraping', scrape_claimed_at = now()
   where id = p_candidate_id and run_id = p_run_id
     and (stage = 'queued' or (stage = 'scraping' and scrape_claimed_at < now() - interval '10 minutes'))
   returning * into c;

  if c.id is null then
    raise exception
      'CANDIDATE_NOT_SCRAPEABLE: % is not a queued candidate of run % (it may already be in flight, already read, or screened out)',
      p_candidate_id, p_run_id using errcode = 'check_violation';
  end if;

  update runs set scrapes_used = scrapes_used + 1 where id = p_run_id;
  return c;
end $$;
