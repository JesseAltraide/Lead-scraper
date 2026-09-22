/**
 * End-to-end harness: drives a complete run against fixtures and prints what
 * actually landed in the database.
 *
 * This exists because "it typechecks" is not evidence the loop works, and
 * because the Part 3 attacks need to be run against a real run rather than
 * asserted about. It spends Anthropic credits; it spends nothing on Apify or
 * Firecrawl while the *_LIVE flags are off.
 *
 *   npx tsx scripts/e2e.ts            # full run
 *   npx tsx scripts/e2e.ts --report   # just re-print the latest run's records
 */

import { db } from "../src/db.js";
import { env } from "../src/env.js";

const TEST_EMAIL = "e2e-harness@example.test";

async function testUserId(): Promise<string> {
  const { data: list } = await db.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === TEST_EMAIL);
  if (existing) return existing.id;

  const { data, error } = await db.auth.admin.createUser({
    email: TEST_EMAIL,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test user: ${error?.message}`);
  return data.user.id;
}

const ICP = {
  industry: "B2B SaaS",
  geography: "United States",
  minEmployees: 10,
  maxEmployees: 100,
  buyerPersona: "Head of Operations",
  businessProblem:
    "Operations teams losing hours a week to manual data entry between their CRM, billing and support tools.",
  hardFilters: [
    { key: "industry", text: "Industry is B2B SaaS" },
    { key: "geography", text: "Located in the United States" },
    { key: "company_size", text: "Between 10 and 100 employees" },
    { key: "must_have:0", text: "Sells to businesses, not consumers" },
  ],
  niceToHave: ["Hiring operations roles"],
  skipIf: ["Is a marketing agency"],
  notes: "",
};

async function createRun(userId: string): Promise<string> {
  // Clear any active run for the harness user so repeated runs don't trip the
  // one-active-run-per-user index.
  await db
    .from("runs")
    .update({ status: "cancelled", stopping_reason: "superseded by a new harness run" })
    .eq("user_id", userId)
    .in("status", ["refining", "awaiting_clarification", "icp_ready", "researching"]);

  const { data, error } = await db
    .from("runs")
    .insert({
      user_id: userId,
      status: "icp_ready",
      form: ICP,
      icp: ICP,
      icp_finalized_at: new Date().toISOString(),
      target_leads: 2,
      max_candidates: 4,
      max_scrapes: 3,
      max_agent_turns: 30,
      max_tool_calls: 40,
    })
    .select("id")
    .single();

  if (error) throw new Error(`could not create run: ${error.message}`);
  return data.id;
}

async function start(runId: string) {
  const res = await fetch(`http://localhost:${env.port}/runs/${runId}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.sharedSecret}` },
  });
  if (!res.ok) {
    throw new Error(
      `agent server refused to start the run (${res.status}). Is it running? ` +
        `Start it with: npm run dev`,
    );
  }
}

const TERMINAL = ["completed", "completed_partial", "failed", "cancelled"];

async function waitForFinish(runId: string, maxMinutes = 10): Promise<string> {
  const deadline = Date.now() + maxMinutes * 60_000;
  let lastSeen = "";

  while (Date.now() < deadline) {
    const { data } = await db
      .from("runs")
      .select("status, candidates_pulled, scrapes_used, tool_calls_used")
      .eq("id", runId)
      .single();

    if (!data) throw new Error("run vanished");

    const line = `${data.status}  candidates=${data.candidates_pulled} scrapes=${data.scrapes_used} tools=${data.tool_calls_used}`;
    if (line !== lastSeen) {
      console.log(`  ${line}`);
      lastSeen = line;
    }

    if (TERMINAL.includes(data.status)) return data.status;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return "timed-out-waiting";
}

async function report(runId: string) {
  const { data: run } = await db.from("runs").select("*").eq("id", runId).single();
  const { data: candidates } = await db
    .from("candidates")
    .select("company_name, domain, employee_count, stage, stage_reason")
    .eq("run_id", runId)
    .order("created_at");
  const { data: leads } = await db
    .from("leads")
    .select("id, company_name, status, confidence, confidence_basis, source_urls")
    .eq("run_id", runId)
    .order("created_at");
  const { data: calls } = await db
    .from("tool_calls")
    .select("tool_name, status, error_message, result_summary")
    .eq("run_id", runId)
    .order("created_at");

  console.log(`\n${"=".repeat(78)}\nRUN ${runId}`);
  console.log(`status            ${run?.status}`);
  console.log(`stopping reason   ${run?.stopping_reason ?? "—"}`);
  if (run?.failure_reason) console.log(`failure           ${run.failed_step}: ${run.failure_reason}`);
  console.log(
    `budget            candidates ${run?.candidates_pulled}/${run?.max_candidates}  ` +
      `scrapes ${run?.scrapes_used}/${run?.max_scrapes}  tools ${run?.tool_calls_used}/${run?.max_tool_calls}`,
  );
  console.log(`cost              $${Number(run?.total_cost_usd ?? 0).toFixed(4)}`);

  console.log(`\nCANDIDATES (${candidates?.length ?? 0})`);
  for (const c of candidates ?? []) {
    console.log(
      `  ${c.company_name.padEnd(32)} ${String(c.employee_count ?? "?").padStart(5)}  ${c.stage}` +
        (c.stage_reason ? `\n      ${c.stage_reason}` : ""),
    );
  }

  console.log(`\nLEADS (${leads?.length ?? 0})`);
  for (const l of leads ?? []) {
    console.log(`  ${l.company_name.padEnd(32)} ${l.status.padEnd(14)} ${l.confidence}`);
    console.log(`      ${l.confidence_basis}`);

    const { data: filters } = await db
      .from("lead_filter_results")
      .select("filter_key, verdict, evidence_kind, evidence")
      .eq("lead_id", l.id);
    for (const f of filters ?? []) {
      console.log(
        `      · ${f.filter_key.padEnd(14)} ${f.verdict.padEnd(10)} ${f.evidence_kind}` +
          (f.evidence ? `  "${f.evidence.slice(0, 60)}"` : ""),
      );
    }
  }

  console.log(`\nTOOL CALLS (${calls?.length ?? 0})`);
  const refusals = (calls ?? []).filter((c) => c.status !== "ok");
  for (const c of calls ?? []) {
    console.log(`  ${c.status.padEnd(8)} ${c.tool_name}${c.error_message ? `  ${c.error_message}` : ""}`);
  }
  console.log(`\n  ${refusals.length} refusal(s)/error(s) — each is a guard that fired.`);
  console.log("=".repeat(78));
}

const reportOnly = process.argv.includes("--report");

if (reportOnly) {
  const { data } = await db
    .from("runs")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  await report(data!.id);
} else {
  const userId = await testUserId();
  const runId = await createRun(userId);
  console.log(`created run ${runId}\nstarting…`);
  await start(runId);
  const status = await waitForFinish(runId);
  console.log(`\nfinished as: ${status}`);
  await report(runId);
}

process.exit(0);
