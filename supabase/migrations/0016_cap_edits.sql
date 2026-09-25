-- Edits were unlimited by explicit earlier design ("costs nothing, needs no
-- slot" per draftStates.ts's own old comment), true when an edit was a plain
-- database write. It stopped being true once checkEditQuality started
-- running a real Claude call on every edit (fail-closed, per a separate
-- explicit user request). Per user direction: cap edits the same way
-- rewrites already are, so this can't run unbounded and waste tokens.
--
-- Enforced the same way rewrites_requested is tracked: a counter column on
-- draft_pieces, checked and incremented inside save_outreach_draft itself
-- (not a separate claim/release dance like rewrites, an edit is a single
-- synchronous request with no async in-flight window to recover from, so it
-- doesn't need one).

alter table draft_pieces add column if not exists edits_requested int not null default 0;

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
