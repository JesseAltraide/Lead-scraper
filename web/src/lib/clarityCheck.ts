import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serviceClient } from "./supabase-server";
import { icpFromForm, type IntakeForm } from "./icp";
import { SYSTEM, parseFindings } from "./clarityRules";

// Re-exported so callers keep importing clarification concepts from one place.
export { blockerResolved, isClarifiableField, CLARIFIABLE_FIELDS } from "./clarityRules";
export type { ClarificationItem, ClarifiableField } from "./clarityRules";

/**
 * Phase 1's single AI call: quality control on a submitted form.
 *
 * Findings come in two kinds, and the difference decides what the user is
 * allowed to do about it:
 *
 *  - `question` — the answer is vague or unverifiable. The user explains, and
 *    the explanation is appended to the ICP as context. Prose is a fine
 *    resolution, because the problem is missing detail.
 *
 *  - `blocker` — two answers contradict each other, so no set of companies
 *    could ever satisfy both. There is nothing to explain: whatever the user
 *    writes, the search is still impossible. The FIELD has to change.
 *
 * A blocker is therefore enforced in code, not by asking nicely: the clarify
 * route refuses to proceed unless one of the conflicting fields actually holds
 * a different value than before. Same principle as everywhere else here — a
 * rule that matters is a check, not an instruction.
 */

/** Full-flow.md Phase 1 Step 2: "Maximum 3 rounds." */
const MAX_CLARIFICATION_ROUNDS = 3;

/**
 * A hard ceiling on the one AI call, because this whole function is awaited
 * INSIDE the HTTP request that creates a run or answers a question. Without
 * it, a hung call leaves the run at `refining` — a status whose only action is
 * Cancel — with the screen still claiming to be working.
 *
 * `signal` rather than the SDK's own `timeout` option deliberately: the SDK
 * retries its timeouts ("in a worst-case scenario you may wait much longer
 * than this timeout"), so only an abort signal is a real ceiling. Matches the
 * AbortSignal.timeout already used for the agent handoff in the action route.
 *
 * This covers a SLOW call. It cannot cover the request being killed outright
 * (serverless limit, deploy, crash) — nothing in-process can. That case is
 * caught by sweep_stalled_runs, which now also reclaims stalled `refining`
 * runs (migration 0008).
 */
const CLARITY_CALL_TIMEOUT_MS = 30_000;

/**
 * Runs the check and moves the run to `awaiting_clarification` or `icp_ready`
 * — or, once 3 rounds have already run and the form is STILL not clear
 * enough, ends the run rather than asking a 4th time.
 *
 * It never leaves the run in `refining`: that status has no user action beyond
 * cancelling, so a run stranded there is a dead end. If the model is
 * unavailable or returns nonsense, the run proceeds with the user's own
 * answers and the reason is recorded — the user sees exactly what was
 * accepted on the icp_ready confirm screen (view-only since Decision #61)
 * before anything is spent.
 *
 * Before this fix, the 3-round cap was only enforced as a 409 error on a 4th
 * SUBMIT attempt — the run itself stayed at `awaiting_clarification` showing
 * a 4th round of questions, with no automatic way out. That is exactly the
 * stuck-state failure Part 2 of the build instructions exists to prevent, so
 * the cap is enforced here instead, at the point the 4th round would be
 * created, not at the point the user tries to answer it.
 */
export async function runClarityCheck(runId: string, form: IntakeForm): Promise<void> {
  const db = serviceClient();
  const icp = icpFromForm(form);

  const { data: run } = await db
    .from("runs")
    .select("clarification_rounds")
    .eq("id", runId)
    .single();
  const roundsSoFar = run?.clarification_rounds ?? 0;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.startsWith("REPLACE_ME")) {
    await finalize(runId, icp, "No ANTHROPIC_API_KEY set — your answers were accepted as written.");
    return;
  }

  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create(
      {
        model: "claude-sonnet-5",
        max_tokens: 1500,
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(form, null, 2) }],
      },
      { signal: AbortSignal.timeout(CLARITY_CALL_TIMEOUT_MS) },
    );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Normalise at the boundary: the reply can arrive fenced or prefixed.
    const json = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    const verdict = JSON.parse(json) as { ok?: boolean; findings?: unknown };
    const findings = parseFindings(verdict.findings);

    if (findings.length === 0) {
      await finalize(runId, icp, "Your answers were clear enough to search.");
      return;
    }

    // roundsSoFar counts rounds already ANSWERED. If 3 have already happened
    // and the form is still unsatisfied, a 4th round would exceed the cap —
    // end the run here instead of asking again.
    if (roundsSoFar >= MAX_CLARIFICATION_ROUNDS) {
      await giveUpAfterMaxRounds(runId);
      return;
    }

    const blockers = findings.filter((f) => f.kind === "blocker").length;

    const { data } = await db
      .from("runs")
      .update({ status: "awaiting_clarification", pending_questions: findings })
      .eq("id", runId)
      .eq("status", "refining")
      .select("id")
      .maybeSingle();

    if (data) {
      await db.from("run_events").insert({
        run_id: runId,
        kind: "status_change",
        status_to: "awaiting_clarification",
        reason: blockers
          ? `${blockers} answer${blockers === 1 ? "" : "s"} contradict each other and must be changed.`
          : `${findings.length} question${findings.length === 1 ? "" : "s"} about your answers.`,
      });
    }
  } catch (err) {
    await finalize(
      runId,
      icp,
      `The check couldn't run (${err instanceof Error ? err.message : "unknown error"}) — your answers were accepted as written. Please review them below before starting.`,
    );
  }
}

/**
 * 3 rounds of clarifying questions have been asked and answered, and the form
 * is still unsatisfied. There is no 4th round — the run ends here.
 *
 * Lands on `cancelled` with no ICP and no leads, which — per the run-states
 * RunContext (runStates.ts) — resolves to exactly one available action:
 * "Start a new search". That is deliberate, not a default: a run this far
 * from a usable ICP has nothing worth reviewing or resuming, so a single,
 * unambiguous path back to the homepage is the honest one rather than
 * offering "start over" into an ICP screen that was never reached.
 */
async function giveUpAfterMaxRounds(runId: string) {
  const db = serviceClient();
  const { data } = await db
    .from("runs")
    .update({
      status: "cancelled",
      pending_questions: null,
      stopping_reason:
        `After ${MAX_CLARIFICATION_ROUNDS} rounds of clarifying questions, the form still wasn't ` +
        "clear enough to search. Start a new search with clearer or more specific answers.",
    })
    .eq("id", runId)
    .eq("status", "refining")
    .select("id")
    .maybeSingle();

  if (data) {
    await db.from("run_events").insert({
      run_id: runId,
      kind: "status_change",
      status_to: "cancelled",
      reason: `Gave up after ${MAX_CLARIFICATION_ROUNDS} rounds of clarification — still not clear enough to search.`,
    });
  }
}

async function finalize(runId: string, icp: unknown, reason: string) {
  const db = serviceClient();
  const { data } = await db
    .from("runs")
    .update({
      status: "icp_ready",
      icp,
      icp_finalized_at: new Date().toISOString(),
      pending_questions: null,
    })
    .eq("id", runId)
    .eq("status", "refining")
    .select("id")
    .maybeSingle();

  if (data) {
    await db.from("run_events").insert({
      run_id: runId,
      kind: "status_change",
      status_to: "icp_ready",
      reason,
    });
  }
}
