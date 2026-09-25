---
name: outbound-copywriting
description: Write review-ready cold outreach — a 3-step email sequence plus a LinkedIn message — for a qualified lead. Use before every call to save_outreach_draft.
---

# Outbound Copywriting

## What to produce

For each **qualified** lead, four pieces, saved one at a time. For a
**needs_review** lead, the same four pieces are allowed but optional, at your
judgment, `save_outreach_draft` no longer refuses it. Never for
`not_qualified`, that refusal stays absolute:

| `piece_key` | Contents |
|---|---|
| `email_1` | Subject, body, personalization note |
| `email_2` | Subject, body, personalization note |
| `email_3` | Subject, body, personalization note |
| `linkedin` | Short message, personalization note (no subject) |

## Who you are writing to

The **buyer persona** on the run's ICP — a role, such as "Head of Operations".
You never look up an actual person, and you never write a name you were not
given. The persona decides the problem framing, the tone, and the ask.

The **business problem** on the ICP is what you are offering to solve. Connect
the company-specific observation to that problem; don't describe the product in
the abstract.

## Sequence structure

- **Email 1** — open with a relevant observation from the company's own source material, connect it to the problem, ask a low-pressure question.
- **Email 2** — a second angle: a workflow bottleneck, a scaling challenge, an operational pattern that connects to automation support.
- **Email 3** — brief. Invite a reply if the timing or the fit is wrong.
- **LinkedIn** — shorter than any of the emails. One observation, one ask.

## Copy rules

- Use the company context gathered during research.
- Short and direct. Write like a person, not a promotion.
- Do not invent details about the company.
- No fake urgency, no exaggerated claims, no generic praise.
- No personal email addresses.
- Nothing you write is sent. These are drafts for a human.

## Personalization must cite

Every `personalization_note` is saved with a `citation_fact` — the specific
thing from the source material it rests on — and, where possible, the
`citation_source_url` it came from.

This is checked in code after generation. A citation that cannot be traced to
the lead's source URLs or source summary is **rejected**, and the draft is not
saved. The same check runs again after any rewrite.

Strong personalization references evidence: website positioning, the product
category, the audience served, a hiring or scaling signal, a public workflow
clue.

Weak personalization — "loved what you're building", "your company looks
impressive", "I saw your website" — has nothing to cite, which is exactly why
it fails the check.

## Before saving each piece

- Does it mention a real, company-specific detail?
- Can every claim be traced to the source context on the lead record?
- Is the ask clear?
- Is the tone calm and credible?
- Would a human want to review this before sending?
