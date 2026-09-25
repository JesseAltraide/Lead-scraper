---
name: lead-list-quality
description: Check the lead list against the quality standard before ending a run. Use with check_list_quality before calling finish_run.
---

# Lead-List Quality

## Required checks

- The list contains the target number of **qualified** companies
- Each has a name and a domain
- Each has qualification reasoning
- Each has source context (source URLs and a source summary)
- Each has all four outreach pieces
- No personal email finding or validation was attempted
- Duplicates removed
- `needs_review` companies are **not** counted as qualified

`check_list_quality` runs these against what is actually in the database, not
against your recollection of the run. Call it before `finish_run` and read what
it returns.

## Scorecard

| Dimension | What to check |
|---|---|
| ICP fit | The lead matches the hard filters in the objective |
| Evidence quality | The decision uses real source context |
| Duplicate rate | The same company does not appear twice |
| Outreach relevance | The sequence uses company-specific context |
| Data completeness | Required fields are present |
| Safety compliance | No emails found, validated or sent |

## The stopping rule

The run ends when the target number of qualified leads is reached, **or** any
limit is hit — whichever comes first.

If a limit is hit with fewer than the target:

- Finish anyway, with `finish_run`, and state plainly why: "hit the scrape limit after 3 websites", not "couldn't find more".
- **Never pad the list.** Prefer fewer strong leads over a larger weak one. A short, honest list passes; a padded one fails both this guide and the qualification guide.
- Do not re-run work that already succeeded in order to reach the number.

If you have candidates left and budget left, searching again within the limits
is legitimate. Searching again with no budget left is not — the tool will
refuse, and the attempt costs a tool call the run may need.

`finish_run` re-counts the qualified leads and re-checks the drafts against the
database before it will mark the run complete. A run whose real contents do not
support completion is recorded as partial, with the reason.
