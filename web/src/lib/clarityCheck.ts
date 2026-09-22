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

/**
 * Runs the check and moves the run to `awaiting_clarification` or `icp_ready`.
 *
 * It never leaves the run in `refining`: that status has no user action beyond
 * cancelling, so a run stranded there is a dead end. If the model is
 * unavailable or returns nonsense, the run proceeds with the user's own
 * answers and the reason is recorded — the user reviews and edits the ICP on
 * the next screen anyway.
 */
export async function runClarityCheck(runId: string, form: IntakeForm): Promise<void> {
  const db = serviceClient();
  const icp = icpFromForm(form);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.startsWith("REPLACE_ME")) {
    await finalize(runId, icp, "No ANTHROPIC_API_KEY set — your answers were accepted as written.");
    return;
  }

  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(form, null, 2) }],
    });

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
