---
name: icp-refinement
description: Turn a submitted intake form into concrete, searchable ICP criteria — and spot vague answers, contradictions, and must-haves that cannot be checked. Used in Phase 1, before any paid discovery.
---

# ICP Refinement

Source: `assets/icp-refinement-guide.md`.

## Goal

Establish who counts as a good-fit company **before** any tool call spends
money on discovery or scraping.

## What is already settled before you see it

In this project the user fills a structured form, so most of the extraction is
already done — and done by the person who actually knows the answer:

- **Industry, geography and company size have dedicated fields and are always hard filters.** They are also what the search itself filters on. They are never repeated in Must have.
- **Must have / Nice to have / Skip if are stated by the user**, not inferred by you. Do not reclassify them.
- **The buyer persona is not a search input.** The agent only ever searches for companies, never people. The persona shapes the outreach copy in Phase 5 and nothing upstream of it.

So your job is not "extract an ICP from prose". It is **quality control on a
form**.

## What to check for

- **Vague answers** that cannot be searched — "Industry: tech", "Buyer: decision makers", "Problem: efficiency"
- **Contradictions** between fields — "10–100 employees" alongside "Skip if: startups"; "Geography: United States" alongside "Must have: EU data residency"
- **Must-haves that cannot be checked** — nothing a company database or a public website could ever confirm: "founder is technical", "budget over $50k", "unhappy with their current vendor"

## When to ask

If any of the above is present, ask for clarification. Each question must point
at **one specific field** and say what would make it answerable. Bad: "can you
be more specific?" Good: "Industry is 'tech' — that's too broad to search. Do
you mean B2B SaaS, IT services, hardware, or something else?"

Maximum 3 rounds. If it is clean, finalise it.

## Hard filters vs soft preferences

Hard filters must be true for a lead to qualify — country is the United States,
the company is B2B, headcount is 10–100.

Soft preferences improve fit but never disqualify — recently hiring operations
roles, uses tools that connect to automation workflows, publishes about scaling.

Do not treat every user preference as a hard filter. Preserve the specific
constraints the user gave. Keep the ICP narrow enough to search, but not so
narrow that nothing can be found.

## After finalising

The user reviews and can edit the finalised ICP before research starts. That is
by design: if the refinement misread the form, the person must be able to
correct it before paid discovery runs.
