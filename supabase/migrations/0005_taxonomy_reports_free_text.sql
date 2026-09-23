-- Adds the "what did you actually mean" free text for a "none of these"
-- report. Without this, choosing "none of these" told a reviewer only that
-- the suggestions were wrong — not what would have been right, which is the
-- one piece of information actually needed to add a real alias.
--
-- Deliberately NOT validated against the taxonomy (unlike suggestions_shown
-- and chosen_label): the whole point of this field is that nothing in the
-- taxonomy already matched, so it has to be free text.

alter table taxonomy_reports
  add column user_described_as text;
