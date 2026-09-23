# Onboarding Guide: Koya Week 5 (Lead Research & Outreach Agent)

## Overview
An outbound lead-generation tool: a user describes their ICP (Ideal Customer
Profile), the system clarifies it, then an autonomous Claude agent discovers
companies, screens them, scrapes qualifying ones, and drafts outreach for
human review. Nothing is ever sent automatically — every output is a draft.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router) + React 19 + Tailwind 4 |
| Agent service | Node/Express + `@anthropic-ai/claude-agent-sdk` |
| Model | `claude-sonnet-5`, invoked via the Agent SDK's `query()` |
| Database/Auth | Supabase (Postgres), via `@supabase/ssr` (web) and `@supabase/supabase-js` (agent) |
| Validation | Zod (both `web` and `agent`) |
| Agent runtime | `tsx` (dev), plain `tsc` typecheck, native `node --test` |

## Architecture

Two separate Node processes, no shared package:

```
web/    → Next.js app: intake form, ICP editor, run status UI, API routes
agent/  → standalone Express service: runs the Claude agent, talks to Supabase directly
supabase/migrations/ → SQL schema + RPC guard functions (source of truth for run state)
```

`web` never calls the Claude Agent SDK directly. It POSTs to `agent`'s HTTP
endpoints (`/runs/:runId/start`, `/runs/:runId/retry`), authenticated with a
shared bearer secret (`agent/src/index.ts`). The agent then works
asynchronously, writing all progress into Supabase; `web` polls/subscribes to
Supabase rather than talking to the agent again.

## Key Entry Points

- **Agent HTTP server**: `agent/src/index.ts` — start/retry endpoints, shared-secret auth, stalled-run sweep
- **Agent loop**: `agent/src/runAgent.ts` — builds the prompt, invokes `query()` from the Claude Agent SDK, resumes on retry
- **Agent tools**: `agent/src/tools.ts`, `agent/src/tools/` — the *only* things the agent can call (MCP tool server, no filesystem/shell/web access)
- **Agent skills**: `agent/.claude/skills/{icp-refinement,lead-qualification,outbound-copywriting,lead-list-quality,outreach-safety}` — loaded via `settingSources: ["project"]`, cwd = `agent/`
- **Run state machine**: `web/src/lib/runStates.ts` — single source of truth for what each run status means and what actions are valid; both the UI and API routes read from this one file
- **DB guard functions**: `supabase/migrations/*.sql` — `claim_run_for_research`, `complete_run`, `fail_run`, `sweep_stalled_runs` are RPCs, not application logic — they enforce state transitions atomically in Postgres
- **Intake/ICP UI**: `web/src/components/{IntakeForm,ClarifyForm,IcpEditor,RunActions}.tsx`

## Request Lifecycle (starting a run)

1. User submits intake → `web` clarifies ambiguous answers → ICP is finalized (`icp_ready`)
2. `web` POSTs `agent/runs/:runId/start` with the shared secret
3. `agent` calls `claim_run_for_research` RPC — a conditional DB update, so concurrent start requests can't double-claim (second gets `409`)
4. `agent` responds `202` immediately, then runs `runAgent()` async
5. `runAgent` builds a prompt from the run's ICP + already-completed candidates (resume-safe), then calls the Claude Agent SDK with a locked-down tool allowlist (only the 7 MCP tools + `Skill`; `Bash/Read/Write/Edit/WebFetch/WebSearch/Glob/Grep` explicitly disallowed)
6. The agent calls tools in order: `discover_companies` → `screen_candidates` → `scrape_website` (only for queued candidates) → `save_lead_qualification` → `save_outreach_draft` → `check_list_quality` → `finish_run`
7. All limits (candidates, scrapes, tool calls) are enforced by the tools themselves, reading the run record from the DB — the agent cannot raise its own budget
8. `web` never talks to the agent again after the initial POST — it reads run/candidate/lead rows from Supabase directly (`useLiveRun.ts`)

## Conventions

- **Naming**: camelCase for `.ts` files in `agent/`, PascalCase for React components in `web/src/components/`, kebab-case elsewhere
- **Money/safety-critical comments**: this codebase writes long, deliberate comments anywhere a bug would mean spending money twice, leaking a secret, or showing a dead-end UI state — see `runStates.ts` and `runAgent.ts` for the tone to match
- **Untrusted data**: text from scraped websites is explicitly treated as data, never instructions (see the agent's system prompt in `runAgent.ts`) — preserve this framing in any new tool/prompt code
- **State authority**: run status is decided in exactly one place per concern — `runStates.ts` for UI/API authorization, SQL RPCs for the actual DB transition. Don't duplicate state logic elsewhere.
- **Commits**: short, plain-language, describe the user-facing effect (e.g. "Hard-block contradictory answers; actually re-run the clarity check"), not conventional-commit prefixes
- **Testing**: `agent` uses Node's built-in test runner (`agent/src/guards.test.ts`, `npm test` → `tsx --test src/**/*.test.ts`); no test setup detected yet in `web`

## Common Tasks

- **Run the agent service**: `cd agent && npm run dev`
- **Run the web app**: `cd web && npm run dev`
- **Typecheck agent**: `cd agent && npm run typecheck`
- **Test agent**: `cd agent && npm test`
- **Lint web**: `cd web && npm run lint`
- **Build web**: `cd web && npm run build`
- **DB migrations**: SQL files under `supabase/migrations/`, applied via Supabase CLI/dashboard (no migration runner script detected in-repo)

## Where to Look

| I want to... | Look at... |
|--------------|-----------|
| Add/change a run status or its available actions | `web/src/lib/runStates.ts` |
| Add a new agent tool | `agent/src/tools.ts`, `agent/src/tools/`, then add to `allowedTools` in `runAgent.ts` |
| Change agent behavior/instructions | `agent/src/runAgent.ts` (`buildPrompt`, `systemPrompt`) or the relevant skill under `agent/.claude/skills/` |
| Add a DB guard/transition | new migration under `supabase/migrations/`, exposed as an RPC, called via `agent/src/db.ts`'s `rpc()` |
| Add an intake/ICP UI field | `web/src/components/IntakeForm.tsx` or `IcpEditor.tsx`, plus `web/src/lib/icp.ts` |
| Change clarity/validation rules | `web/src/lib/clarityCheck.ts`, `clarityRules.ts` |
| Add a web API route | `web/src/app/api/` |

## Open Questions / Gaps Noticed

- No test setup found in `web/` — worth adding if you want CI coverage on the frontend
- `docs/` was empty before this guide — now the natural home for further ADRs, run-books, etc.
- No root-level lockstep migration runner script — confirm how migrations actually get applied to your Supabase project (CLI vs dashboard) before changing schema
