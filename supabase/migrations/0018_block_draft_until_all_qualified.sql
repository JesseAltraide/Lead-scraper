-- Same reasoning as 0017 (which stops save_lead_qualification from running
-- ahead of scraping), one stage further down: save_outreach_draft should not
-- write a lead's FIRST draft while other candidates in the run are still
-- unscreened, unscraped, or scraped-but-not-yet-qualified and there is
-- budget left to finish them. Otherwise the agent can interleave qualifying
-- one company with drafting for it while a sibling candidate is still
-- sitting unread, producing outreach for some leads while the run's actual
-- qualified set is still incomplete.
--
-- Scoped to p_origin = 'initial' only. A rewrite or a manual edit targets a
-- draft that already exists on an already-qualified lead — it is not "the
-- run getting ahead of itself", so those stay ungated, exactly as before.
--
-- (The manual "write missing drafts" feature calls this with p_origin =
-- 'initial' too, so it inherits the same guard — appropriate, since writing
-- one lead's drafts while others in the same run are still unprocessed is
-- the same problem whether the agent or a person triggered it.)

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
declare
  st lead_status;
  lead_run_id uuid;
  piece draft_pieces;
  v draft_versions;
  n_unscreened int;
  n_unscraped int;
  n_unqualified int;
  r runs;
begin
  select status, run_id into st, lead_run_id from leads where id = p_lead_id for update;

  if st is null then
    raise exception 'LEAD_NOT_FOUND: %', p_lead_id using errcode = 'check_violation';
  end if;

  if st = 'not_qualified' then
    raise exception 'LEAD_NOT_QUALIFIED: lead % is not_qualified, drafts are never written for a lead that failed a hard filter',
      p_lead_id using errcode = 'check_violation';
  end if;

  if p_origin = 'initial' then
    select * into r from runs where id = lead_run_id for update;

    -- `discovered`: not yet screened. Gate on tool-call budget, same as 0017.
    select count(*) into n_unscreened
      from candidates where run_id = lead_run_id and stage = 'discovered';

    -- `queued`/`scraping`: screened, not yet read. Gate on scrape budget.
    select count(*) into n_unscraped
      from candidates where run_id = lead_run_id and stage in ('queued', 'scraping');

    -- `scraped`: read, but no lead record yet — still needs a qualification
    -- call, which is a plain tool call with no budget of its own beyond the
    -- general tool-call cap.
    select count(*) into n_unqualified
      from candidates where run_id = lead_run_id and stage = 'scraped';

    if (n_unscreened > 0 and r.tool_calls_used < r.max_tool_calls)
       or (n_unscraped > 0 and r.scrapes_used < r.max_scrapes)
       or (n_unqualified > 0 and r.tool_calls_used < r.max_tool_calls) then
      raise exception
        'UNPROCESSED_CANDIDATES: % unscreened, % unscraped, % scraped but unqualified, with budget remaining (tool calls % of %, scrapes % of %) — finish qualifying every candidate before drafting for any of them',
        n_unscreened, n_unscraped, n_unqualified, r.tool_calls_used, r.max_tool_calls, r.scrapes_used, r.max_scrapes
        using errcode = 'check_violation';
    end if;
  end if;

  insert into draft_pieces (lead_id, piece_key)
  values (p_lead_id, p_piece_key)
  on conflict (lead_id, piece_key) do update set lead_id = excluded.lead_id
  returning * into piece;

  if p_origin = 'edit' then
    if piece.edits_requested >= 3 then
      raise exception 'EDIT_CAP_REACHED: % edits already used for this piece', piece.edits_requested
        using errcode = 'check_violation';
    end if;
    update draft_pieces set edits_requested = edits_requested + 1
     where id = piece.id
     returning * into piece;
  end if;

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
