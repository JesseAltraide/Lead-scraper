-- Follow-up to 0006 (found in code review, not yet a real incident): the free
-- cache-read match compared p_url to scraped_urls with byte-exact equality.
-- A re-request differing only by a trailing slash or letter case would count
-- as a "new" URL and fall through to a real, budget-checked claim instead of
-- being served from cache for free — not a security issue, just a missed
-- free re-read. Normalizing (lowercase, strip one trailing slash) on both
-- sides of the comparison closes that gap without changing what counts as
-- a genuinely different URL.
create or replace function claim_scrape_budget(p_run_id uuid, p_candidate_id uuid, p_url text default null)
returns candidates language plpgsql security definer as $$
declare c candidates; used int; cap int; norm_url text;
begin
  select scrapes_used, max_scrapes into used, cap
    from runs where id = p_run_id and status = 'researching' for update;
  if cap is null then
    raise exception 'RUN_NOT_RESEARCHING: run % cannot scrape right now', p_run_id
      using errcode = 'check_violation';
  end if;

  if p_url is not null then
    norm_url := lower(regexp_replace(p_url, '/+$', ''));
    select * into c from candidates
      where id = p_candidate_id and run_id = p_run_id
        and stage = 'scraped'
        and exists (
          select 1 from unnest(scraped_urls) as u
          where lower(regexp_replace(u, '/+$', '')) = norm_url
        );
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
