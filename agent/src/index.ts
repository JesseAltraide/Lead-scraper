import express from "express";
import { timingSafeEqual } from "node:crypto";
import { env, describeProviders } from "./env.js";
import { db, rpc } from "./db.js";
import { runAgent } from "./runAgent.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

/**
 * Shared-secret auth. An open endpoint means anyone who finds it can trigger
 * runs and spend the pooled Apify budget.
 */
function authorized(header: string | undefined): boolean {
  if (!header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${env.sharedSecret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (!authorized(req.headers.authorization)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, worker: env.workerId });
});

/**
 * Accepts a run and returns immediately. The agent runs async, writing progress
 * to Supabase; the frontend polls Supabase for it.
 *
 * `claim_run_for_research` is a conditional update, so two near-simultaneous
 * POSTs for the same run cannot both start an agent — the second gets a 409.
 */
app.post("/runs/:runId/start", async (req, res) => {
  const runId = req.params.runId;

  try {
    await rpc("claim_run_for_research", { p_run_id: runId, p_worker: env.workerId });
  } catch {
    res.status(409).json({ error: "run is not in icp_ready with a finalised ICP" });
    return;
  }

  // Claimed. Hand back immediately; a full run takes minutes.
  res.status(202).json({ accepted: true, run_id: runId });

  void (async () => {
    try {
      const outcome = await runAgent(runId, { alreadyClaimed: true });
      console.log(`[run ${runId}] finished as ${outcome.status} in ${outcome.turns} turns`);
    } catch (err) {
      console.error(`[run ${runId}] crashed:`, err);
      await rpc("fail_run", {
        p_run_id: runId,
        p_step: "agent_loop",
        p_reason: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    }
  })();
});

/**
 * Retry after `failed`. Moves the run back to icp_ready so the same claim path
 * runs, then starts the agent — which resumes from the saved candidates and
 * cached scrapes rather than restarting.
 */
app.post("/runs/:runId/retry", async (req, res) => {
  const runId = req.params.runId;

  const { data, error } = await db
    .from("runs")
    .update({ status: "icp_ready", failure_reason: null, failed_step: null })
    .eq("id", runId)
    .in("status", ["failed", "completed_partial", "cancelled"])
    .select("id")
    .maybeSingle();

  if (error || !data) {
    res.status(409).json({ error: "run is not in a retryable state" });
    return;
  }

  await db.from("run_events").insert({
    run_id: runId,
    kind: "note",
    reason: "Retry requested — resuming from the work already completed",
  });

  res.status(202).json({ accepted: true, run_id: runId });

  void runAgent(runId).catch((err) => console.error(`[run ${runId}] retry crashed:`, err));
});

/** Reclaims runs that have gone silent. Not a substitute for a real failure signal. */
setInterval(
  () => {
    void rpc("sweep_stalled_runs", { p_stale_minutes: 10 }).catch((err) =>
      console.error("[sweep] failed:", err),
    );
  },
  60_000,
);

app.listen(env.port, () => {
  console.log(`agent server listening on :${env.port} (worker ${env.workerId})`);
  console.log(describeProviders());
});
