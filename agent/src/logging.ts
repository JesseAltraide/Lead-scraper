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

export type ToolContext = { runId: string };

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
 */
async function claimToolCallBudget(runId: string): Promise<{ used: number; cap: number } | null> {
  const { data, error } = await db.rpc("claim_tool_call_budget", { p_run_id: runId });
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
      await claimToolCallBudget(ctx.runId);
    } catch (err) {
      const g = asGuardError(err);
      await log(ctx.runId, toolName, purpose, args, "refused", null, g.message, Date.now() - startedAt);
      return { ok: false, code: g.code, message: g.message };
    }

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
    }
  };
}

/** The agent sees this. Refusals are returned as readable text, not thrown. */
export function renderToolResult(result: ToolResult): string {
  if (result.ok) return JSON.stringify(result.data, null, 2);
  return `REFUSED (${result.code}): ${result.message}`;
}
