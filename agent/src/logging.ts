import { db, asGuardError, GuardError } from "./db.js";
import { summarize } from "./normalize.js";

/**
 * Every tool call is logged here, by the wrapper, on every path — success,
 * refusal and error alike. Nothing depends on the agent choosing to log,
 * because a confused agent produces gaps in exactly the runs you most need
 * to debug.
 *
 * The wrapper also enforces the run-wide tool-call cap, which is why it also
 * has to be the thing that counts.
 */

export type ToolResult = { ok: true; data: unknown } | { ok: false; code: string; message: string };

export type ToolContext = { runId: string; generation: number };

async function log(
  runId: string,
  toolName: string,
  purpose: string,
  input: unknown,
  status: "ok" | "refused" | "error",
  result: unknown,
  errorMessage: string | null,
  durationMs: number,
) {
  const { error } = await db.from("tool_calls").insert({
    run_id: runId,
    tool_name: toolName,
    purpose,
    input_summary: summarize(input),
    result_summary: summarize(result),
    status,
    error_message: errorMessage,
    duration_ms: durationMs,
  });
  // A logging failure must never take the run down, but it must be visible.
  if (error) console.error(`[tool-log] failed to record ${toolName}:`, error.message);
}

/**
 * Claims one unit of the run's tool-call budget. Conditional update: the check
 * and the increment are the same statement, so concurrent calls cannot both
 * see the last remaining slot.
 *
 * generation is the fencing token this process was handed at claim time
 * (see claim_generation, migration 0020). Passing it here is what makes a
 * superseded process (one whose run was reclaimed by a newer runAgent()
 * call after Stop-then-quick-Retry) fail on its very next tool call, instead
 * of continuing to write against a run it no longer actually owns.
 */
async function claimToolCallBudget(
  runId: string,
  generation: number,
): Promise<{ used: number; cap: number } | null> {
  const { data, error } = await db.rpc("claim_tool_call_budget", {
    p_run_id: runId,
    p_generation: generation,
  });
  if (error) throw asGuardError(error);
  return data as { used: number; cap: number } | null;
}

export function wrapTool<Args>(
  toolName: string,
  purpose: string,
  handler: (args: Args, ctx: ToolContext) => Promise<unknown>,
) {
  return async (args: Args, ctx: ToolContext): Promise<ToolResult> => {
    const startedAt = Date.now();

    try {
      await claimToolCallBudget(ctx.runId, ctx.generation);
    } catch (err) {
      const g = asGuardError(err);
      await log(ctx.runId, toolName, purpose, args, "refused", null, g.message, Date.now() - startedAt);
      return { ok: false, code: g.code, message: g.message };
    }

    // Live "what's happening right now" signal for the UI (disabling Stop
    // during a scrape, showing a drafting spinner) — cleared unconditionally
    // in `finally` so a thrown handler never leaves it stuck on. A failure to
    // set/clear this must never take the run down, same posture as log().
    await db
      .from("runs")
      .update({ active_tool: toolName })
      .eq("id", ctx.runId)
      .then(() => {}, () => {});

    try {
      const data = await handler(args, ctx);
      await log(ctx.runId, toolName, purpose, args, "ok", data, null, Date.now() - startedAt);
      return { ok: true, data };
    } catch (err) {
      const g = err instanceof GuardError ? err : asGuardError(err);
      // A guard firing is a refusal (expected, informative). Anything else is
      // an error. The distinction matters: a refusal is not a failed run.
      const status = g.code === "UNKNOWN" ? "error" : "refused";
      await log(ctx.runId, toolName, purpose, args, status, null, g.message, Date.now() - startedAt);
      return { ok: false, code: g.code, message: g.message };
    } finally {
      await db
        .from("runs")
        .update({ active_tool: null })
        .eq("id", ctx.runId)
        .then(() => {}, () => {});
    }
  };
}

/** The agent sees this. Refusals are returned as readable text, not thrown. */
export function renderToolResult(result: ToolResult): string {
  if (result.ok) return JSON.stringify(result.data, null, 2);
  return `REFUSED (${result.code}): ${result.message}`;
}
