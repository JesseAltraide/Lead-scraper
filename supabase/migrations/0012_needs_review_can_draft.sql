-- save_outreach_draft — now also allows `needs_review` leads, not only
-- `qualified`. Drafting for a needs_review lead is optional (nothing forces
-- it, and lead-list-quality's target count still ignores needs_review
-- entirely), but it is no longer a hard refusal, per the user's explicit
-- request: "the option of still creating a draft for them should be there."
-- `not_qualified` is still refused outright, unchanged, there is never a
-- legitimate reason to draft outreach for a company that failed a hard
-- filter. Body is otherwise byte-identical to 0002_guards.sql.
--
-- Note: qualification itself (save_lead_qualification) is UNCHANGED here —
-- an earlier draft of this migration also tied `qualified` to a perfect
-- confidence score, but that part was reverted per explicit follow-up
-- instruction: "go back to if all hard filters pass then they are
-- qualified." Status still depends only on the filter verdicts, exactly as
-- in 0002_guards.sql.

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
declare st lead_status; piece draft_pieces; v draft_versions;
begin
  select status into st from leads where id = p_lead_id for update;

  if st is null then
    raise exception 'LEAD_NOT_FOUND: %', p_lead_id using errcode = 'check_violation';
  end if;

  if st = 'not_qualified' then
    raise exception 'LEAD_NOT_QUALIFIED: lead % is not_qualified, drafts are never written for a lead that failed a hard filter',
      p_lead_id using errcode = 'check_violation';
  end if;

  insert into draft_pieces (lead_id, piece_key)
  values (p_lead_id, p_piece_key)
  on conflict (lead_id, piece_key) do update set lead_id = excluded.lead_id
  returning * into piece;

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
