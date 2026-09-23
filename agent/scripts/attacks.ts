/**
 * PART 3 — deliberate attacks on the guards.
 *
 * The rule this file exists to satisfy: no safeguard is written up as working
 * until someone has actually tried to break it. A clean happy-path run is not
 * evidence that a guard holds.
 *
 * Every test below ATTEMPTS the forbidden thing and asserts it was refused.
 * These go straight at the tools and the SQL guards rather than asking the
 * agent nicely, because the guard has to hold against a caller that is trying
 * to get past it — not just against a well-behaved one.
 *
 *   npx tsx scripts/attacks.ts
 */

import { db, rpc, asGuardError } from "../src/db.js";

const TEST_EMAIL = "attack-harness@example.test";

let passed = 0;
let failed = 0;

function ok(name: string, detail = "") {
  passed += 1;
  console.log(`  PASS  ${name}${detail ? `\n          ${detail}` : ""}`);
}

function bad(name: string, detail: string) {
  failed += 1;
  console.log(`  FAIL  ${name}\n          ${detail}`);
}

/** Asserts the call was refused, and refused for the RIGHT reason. */
async function mustRefuse(name: string, expectedCode: string, fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    bad(name, `expected ${expectedCode}, but the call SUCCEEDED: ${JSON.stringify(result).slice(0, 160)}`);
  } catch (err) {
    const g = asGuardError(err);
    if (g.code === expectedCode) ok(name, g.message.slice(0, 120));
    else bad(name, `expected ${expectedCode}, got ${g.code}: ${g.message.slice(0, 140)}`);
  }
}

async function mustSucceed(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, `expected success, got: ${asGuardError(err).message.slice(0, 160)}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

async function userId(): Promise<string> {
  const { data: list } = await db.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === TEST_EMAIL);
  if (existing) return existing.id;
  const { data, error } = await db.auth.admin.createUser({
    email: TEST_EMAIL,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message);
  return data.user.id;
}

const ICP = {
  industry: "B2B SaaS",
  industryId: "4", // "Software Development" — nearest LinkedIn taxonomy match to "B2B SaaS"
  geography: "United States",
  minEmployees: 10,
  maxEmployees: 100,
  companySizeBand: "51-200", // nearest actor band to this fixture's 10-100 range
  buyerPersona: "Head of Operations",
  businessProblem: "Manual data entry between systems.",
  hardFilters: [
    { key: "industry", text: "Industry is B2B SaaS" },
    { key: "geography", text: "Located in the United States" },
    { key: "company_size", text: "Between 10 and 100 employees" },
  ],
  niceToHave: [],
  skipIf: [],
  notes: "",
};

async function freshRun(uid: string, overrides: Record<string, unknown> = {}): Promise<string> {
  await db
    .from("runs")
    .update({ status: "cancelled" })
    .eq("user_id", uid)
    .in("status", ["refining", "awaiting_clarification", "icp_ready", "researching"]);

  const { data, error } = await db
    .from("runs")
    .insert({
      user_id: uid,
      status: "icp_ready",
      form: ICP,
      icp: ICP,
      icp_finalized_at: new Date().toISOString(),
      target_leads: 2,
      max_candidates: 3,
      max_scrapes: 2,
      max_agent_turns: 20,
      max_tool_calls: 40,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function addCandidate(runId: string, name: string, domain: string | null, stage: string) {
  const { data, error } = await db
    .from("candidates")
    .insert({
      run_id: runId,
      company_name: name,
      domain,
      domain_normalized: domain,
      employee_count: 42,
      location: "Austin, TX, United States",
      industry: "B2B SaaS",
      stage,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

// ---------------------------------------------------------------------------

const uid = await userId();
console.log("\nPART 3 — ATTACKING THE GUARDS\n");

// === 1. The Apify limit ====================================================
console.log("1. Discovery limit — the agent explicitly asks for more than the cap");
{
  const runId = await freshRun(uid, { max_candidates: 3 });
  await rpc("claim_run_for_research", { p_run_id: runId, p_worker: "attack" });

  // The agent asks for 500. The tool reads the cap from the run record.
  const granted = await rpc<number>("claim_candidate_budget", {
    p_run_id: runId,
    p_requested: 500,
  });

  if (granted === 3) ok("asking for 500 is granted only 3 (the run's cap)", `granted=${granted}`);
  else bad("asking for 500 is granted only 3", `granted ${granted}, expected 3`);

  // And once spent, asking again is refused outright rather than topped up.
  await mustRefuse("a second request after the cap is exhausted is refused", "CANDIDATE_CAP_REACHED", () =>
    rpc("claim_candidate_budget", { p_run_id: runId, p_requested: 1 }),
  );
}

// === 2. Concurrency ========================================================
console.log("\n2. Concurrency — two simultaneous claims on the same record");
{
  const runId = await freshRun(uid);

  // Two near-simultaneous attempts to claim the same run for research.
  const results = await Promise.allSettled([
    rpc("claim_run_for_research", { p_run_id: runId, p_worker: "worker-a" }),
    rpc("claim_run_for_research", { p_run_id: runId, p_worker: "worker-b" }),
  ]);
  const wins = results.filter((r) => r.status === "fulfilled").length;
  if (wins === 1) ok("exactly one of two concurrent run-claims wins", `${wins} winner, 1 refused`);
  else bad("exactly one of two concurrent run-claims wins", `${wins} succeeded — both got through`);

  // Two simultaneous scrape claims on the SAME candidate.
  const candId = await addCandidate(runId, "Concurrent Co", "concurrent.example", "queued");
  const scrapes = await Promise.allSettled([
    rpc("claim_scrape_budget", { p_run_id: runId, p_candidate_id: candId }),
    rpc("claim_scrape_budget", { p_run_id: runId, p_candidate_id: candId }),
  ]);
  const scrapeWins = scrapes.filter((r) => r.status === "fulfilled").length;
  if (scrapeWins === 1) ok("exactly one of two concurrent scrape-claims wins");
  else bad("exactly one of two concurrent scrape-claims wins", `${scrapeWins} succeeded`);
}

// === 3. Status derivation ==================================================
console.log("\n3. Status derivation — claiming `qualified` when the evidence says otherwise");
{
  const runId = await freshRun(uid);
  await rpc("claim_run_for_research", { p_run_id: runId, p_worker: "attack" });

  const candId = await addCandidate(runId, "Unknown Co", "unknowns.example", "scraped");

  const base = {
    p_run_id: runId,
    p_candidate_id: candId,
    p_confidence: 95,
    p_confidence_basis: "looks great to me",
    p_fit_reasons: ["great fit"],
    p_concerns: [],
    p_source_urls: ["https://unknowns.example/"],
    p_source_summary: "A company website.",
  };

  // One hard filter unknown -> must be needs_review. Claiming qualified is the
  // exact bug this guard exists for: a self-assessment standing in for a check.
  const withUnknown = [
    { filter_key: "industry", filter_text: "B2B SaaS", verdict: "confirmed", evidence: "B2B SaaS company", evidence_kind: "direct" },
    { filter_key: "geography", filter_text: "US", verdict: "confirmed", evidence: "Austin, Texas", evidence_kind: "direct" },
    { filter_key: "company_size", filter_text: "10-100", verdict: "unknown" },
  ];

  await mustRefuse("`qualified` with one unknown filter is REJECTED", "STATUS_MISMATCH", () =>
    rpc("save_lead_qualification", { ...base, p_claimed_status: "qualified", p_filters: withUnknown }),
  );

  await mustSucceed("the same evidence saved as `needs_review` is accepted", () =>
    rpc("save_lead_qualification", { ...base, p_claimed_status: "needs_review", p_filters: withUnknown }),
  );

  // A failed filter cannot be dressed up as needs_review either.
  const cand2 = await addCandidate(runId, "Failing Co", "failing.example", "scraped");
  await mustRefuse("`needs_review` when a filter actually FAILED is REJECTED", "STATUS_MISMATCH", () =>
    rpc("save_lead_qualification", {
      ...base,
      p_candidate_id: cand2,
      p_claimed_status: "needs_review",
      p_filters: [
        { filter_key: "industry", filter_text: "B2B SaaS", verdict: "confirmed", evidence: "B2B SaaS", evidence_kind: "direct" },
        { filter_key: "geography", filter_text: "US", verdict: "confirmed", evidence: "Texas", evidence_kind: "direct" },
        { filter_key: "company_size", filter_text: "10-100", verdict: "failed", evidence: "4,200 employees" },
      ],
    }),
  );

  // A company with no website can never be qualified.
  const noSite = await addCandidate(runId, "No Website Co", null, "discovered");
  await mustRefuse("a company with no website cannot be qualified", "NO_WEBSITE", () =>
    rpc("save_lead_qualification", {
      ...base,
      p_candidate_id: noSite,
      p_claimed_status: "qualified",
      p_filters: [
        { filter_key: "industry", filter_text: "B2B SaaS", verdict: "confirmed", evidence: "x", evidence_kind: "direct" },
      ],
    }),
  );
}

// === 4. Draft gate =========================================================
console.log("\n4. Draft gate — writing outreach for a lead that is not qualified");
{
  const { data: lead } = await db
    .from("leads")
    .select("id, status")
    .eq("status", "needs_review")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lead) {
    bad("draft for a needs_review lead is refused", "no needs_review lead available to test against");
  } else {
    await mustRefuse("a draft for a `needs_review` lead is REFUSED", "LEAD_NOT_QUALIFIED", () =>
      rpc("save_outreach_draft", {
        p_lead_id: lead.id,
        p_piece_key: "email_1",
        p_subject: "Quick question",
        p_body: "Hello there",
        p_personalization_note: "n/a",
        p_citation_source_url: null,
        p_citation_fact: "they have a website",
        p_origin: "initial",
        p_rewrite_note: null,
      }),
    );
  }
}

// === 5. Scrape restriction =================================================
console.log("\n5. Scrape restriction — reading a domain that is not this run's candidate");
{
  const runIdA = await freshRun(uid);
  await rpc("claim_run_for_research", { p_run_id: runIdA, p_worker: "attack" });
  const foreign = await addCandidate(runIdA, "Other Run Co", "otherrun.example", "queued");

  const runIdB = await freshRun(uid);
  await rpc("claim_run_for_research", { p_run_id: runIdB, p_worker: "attack" });

  // Run B tries to scrape Run A's candidate — this is the shape of "the page
  // told me to go read this other site".
  await mustRefuse(
    "scraping another run's candidate is REFUSED",
    "CANDIDATE_NOT_SCRAPEABLE",
    () => rpc("claim_scrape_budget", { p_run_id: runIdB, p_candidate_id: foreign }),
  );

  // A candidate already screened out cannot be revisited.
  const screenedOut = await addCandidate(runIdB, "Screened Out Co", "screenedout.example", "screened_out");
  await mustRefuse(
    "scraping a screened-out candidate is REFUSED",
    "CANDIDATE_NOT_SCRAPEABLE",
    () => rpc("claim_scrape_budget", { p_run_id: runIdB, p_candidate_id: screenedOut }),
  );
}

// === 6. Rewrite cap ========================================================
console.log("\n6. Rewrite cap — claim before acting, release on failure");
{
  const runId = await freshRun(uid);
  await rpc("claim_run_for_research", { p_run_id: runId, p_worker: "attack" });
  const candId = await addCandidate(runId, "Rewrite Co", "rewrite.example", "scraped");

  const lead = await rpc<{ id: string }>("save_lead_qualification", {
    p_run_id: runId,
    p_candidate_id: candId,
    p_claimed_status: "qualified",
    p_confidence: 100,
    p_confidence_basis: "all direct",
    p_fit_reasons: ["fits"],
    p_concerns: [],
    p_source_urls: ["https://rewrite.example/"],
    p_source_summary: "A B2B SaaS company in Texas with 42 staff.",
    p_filters: ICP.hardFilters.map((f) => ({
      filter_key: f.key,
      filter_text: f.text,
      verdict: "confirmed",
      evidence: "stated on the website",
      evidence_kind: "direct",
    })),
  });

  // Two rapid clicks on Rewrite: only one may claim a slot.
  const clicks = await Promise.allSettled([
    rpc("claim_rewrite_slot", { p_lead_id: lead.id, p_piece_key: "email_1" }),
    rpc("claim_rewrite_slot", { p_lead_id: lead.id, p_piece_key: "email_1" }),
  ]);
  const claimed = clicks.filter((c) => c.status === "fulfilled").length;
  if (claimed === 1) ok("a double-click claims only ONE rewrite slot");
  else bad("a double-click claims only one rewrite slot", `${claimed} claims succeeded`);

  const piece = clicks.find((c) => c.status === "fulfilled") as
    | PromiseFulfilledResult<{ id: string; rewrites_requested: number }>
    | undefined;

  // Releasing a FAILED rewrite must give the slot back — claiming and then
  // failing without releasing silently eats the cap forever.
  await rpc("release_rewrite_slot", { p_piece_id: piece!.value.id, p_succeeded: false });
  const { data: after } = await db
    .from("draft_pieces")
    .select("rewrites_requested, rewrite_in_flight")
    .eq("id", piece!.value.id)
    .single();

  if (after?.rewrites_requested === 0 && after.rewrite_in_flight === false) {
    ok("a failed rewrite releases its slot rather than consuming it");
  } else {
    bad(
      "a failed rewrite releases its slot",
      `rewrites_requested=${after?.rewrites_requested}, in_flight=${after?.rewrite_in_flight}`,
    );
  }

  // Burn the cap and confirm the fourth is refused.
  for (let i = 0; i < 3; i++) {
    const p = await rpc<{ id: string }>("claim_rewrite_slot", {
      p_lead_id: lead.id,
      p_piece_key: "email_2",
    });
    await rpc("release_rewrite_slot", { p_piece_id: p.id, p_succeeded: true });
  }
  await mustRefuse("a 4th rewrite of the same piece is REFUSED", "REWRITE_UNAVAILABLE", () =>
    rpc("claim_rewrite_slot", { p_lead_id: lead.id, p_piece_key: "email_2" }),
  );
}

// === 7. Completion honesty =================================================
console.log("\n7. Completion — a run whose contents don't support it cannot complete");
{
  const runId = await freshRun(uid);
  await rpc("claim_run_for_research", { p_run_id: runId, p_worker: "attack" });
  const candId = await addCandidate(runId, "Draftless Co", "draftless.example", "scraped");

  await rpc("save_lead_qualification", {
    p_run_id: runId,
    p_candidate_id: candId,
    p_claimed_status: "qualified",
    p_confidence: 100,
    p_confidence_basis: "all direct",
    p_fit_reasons: ["fits"],
    p_concerns: [],
    p_source_urls: ["https://draftless.example/"],
    p_source_summary: "A B2B SaaS company.",
    p_filters: ICP.hardFilters.map((f) => ({
      filter_key: f.key,
      filter_text: f.text,
      verdict: "confirmed",
      evidence: "stated on the website",
      evidence_kind: "direct",
    })),
  });

  // A qualified lead with no drafts must block completion.
  await mustRefuse(
    "completing with a qualified lead that has no drafts is REFUSED",
    "INCOMPLETE_DRAFTS",
    () => rpc("complete_run", { p_run_id: runId, p_stopping_reason: "claiming this is done" }),
  );
}

// === 8. Unique invariants ==================================================
console.log("\n8. Schema invariants — enforced by the database, not by convention");
{
  const runId = await freshRun(uid);
  await addCandidate(runId, "Dupe Co", "dupe.example", "discovered");
  const { error: dupeErr } = await db.from("candidates").insert({
    run_id: runId,
    company_name: "Dupe Co (again)",
    domain: "dupe.example",
    domain_normalized: "dupe.example",
    stage: "discovered",
  });
  if (dupeErr?.code === "23505") ok("the same domain twice in one run is REJECTED by the index");
  else bad("duplicate domain is rejected", `insert returned ${dupeErr?.code ?? "success"}`);

  // A second active run for the same user must be impossible.
  const { error: secondRun } = await db.from("runs").insert({
    user_id: uid,
    status: "researching",
    form: ICP,
    icp: ICP,
    target_leads: 2,
    max_candidates: 3,
    max_scrapes: 2,
    max_agent_turns: 20,
    max_tool_calls: 40,
  });
  if (secondRun?.code === "23505") ok("a second active run for the same user is REJECTED");
  else bad("second active run is rejected", `insert returned ${secondRun?.code ?? "success"}`);
}

// ---------------------------------------------------------------------------

console.log(`\n${"=".repeat(60)}`);
console.log(`${passed} passed, ${failed} failed`);
console.log("=".repeat(60));
process.exit(failed === 0 ? 0 : 1);
