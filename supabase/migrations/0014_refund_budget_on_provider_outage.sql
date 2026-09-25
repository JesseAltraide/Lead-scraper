-- User's own point, and a real gap: if a provider (Apify or Firecrawl) is
-- genuinely unreachable, the run's own limited budget should not be spent on
-- an attempt that produced nothing. That is different from a scrape that
-- reached the target site and found nothing useful, or an Apify call that
-- legitimately returned zero matching companies, both of those are real
-- outcomes worth their spend. An outage is not.
--
-- Two gaps existed:
--
-- 1. `release_scrape_claim` (0003) already ran when a scrape threw before
--    completing, but it only reset the candidate back to `queued` for a
--    retry, it never gave back the `scrapes_used` slot the failed attempt
--    had already spent. Fixed here: it now also decrements `scrapes_used`
--    (clamped at 0), so a retry after an outage costs a fresh slot rather
--    than paying twice for one attempt that never happened.
--
-- 2. `claim_candidate_budget` (discovery) had no refund path at all. If the
--    Apify call itself threw, the budget it had already claimed for that
--    call stayed spent forever, on zero candidates. `release_candidate_claim`
--    is the new symmetric function: agent/src/tools.ts calls it with the
--    exact amount that was granted, giving it back if the search never
--    actually returned a result.
--
-- Both only fire on a genuine provider-level failure (a thrown error before
-- any usable response, see agent/src/providers/scraper.ts and
-- companySearch.ts), never on a real "nothing found" or "this site had
-- nothing worth reading" outcome, which stay chargeable exactly as before.

create or replace function release_scrape_claim(p_candidate_id uuid, p_reason text)
returns void language plpgsql security definer as $$
declare v_run_id uuid;
begin
  update candidates
     set stage = 'queued',
         scrape_claimed_at = null,
         stage_reason = p_reason
   where id = p_candidate_id and stage = 'scraping'
  returning run_id into v_run_id;

  if v_run_id is not null then
    update runs set scrapes_used = greatest(0, scrapes_used - 1) where id = v_run_id;
  end if;
end $$;

create or replace function release_candidate_claim(p_run_id uuid, p_granted int, p_reason text)
returns void language plpgsql security definer as $$
begin
  update runs
     set candidates_pulled = greatest(0, candidates_pulled - p_granted)
   where id = p_run_id;

  insert into run_events (run_id, kind, reason)
  values (p_run_id, 'note', p_reason);
end $$;
