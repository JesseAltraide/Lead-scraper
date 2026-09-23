/**
 * ONE real, live call to the confirmed Apify actor — the "test small first"
 * step the PRD requires before scaling up. Requests exactly 2 candidates.
 *
 * This deliberately does NOT flip APIFY_LIVE in agent/.env. It imports the
 * real `ApifyProvider` class directly and calls it once, so the persistent
 * "spending is opt-in" setting is untouched — this script itself is the
 * one-off opt-in, for this one call, nothing more.
 *
 * global.fetch is wrapped rather than the request logged from inside
 * ApifyProvider, so what's printed is exactly the bytes sent and received —
 * no risk of the printed JSON drifting from what the actor actually saw.
 *
 *   npx tsx scripts/live-actor-test.ts
 */

import { env } from "../src/env.js";
import { ApifyProvider } from "../src/providers/companySearch.js";

if (!env.apifyToken || !env.apifyActorId) {
  console.error("APIFY_TOKEN / APIFY_ACTOR_ID must be set in agent/.env to run this.");
  process.exit(1);
}

const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(init.body as string) : null;

  console.log("=".repeat(78));
  console.log("REQUEST");
  console.log("=".repeat(78));
  // The token is a query param on this URL — redact it before printing.
  console.log(url.replace(/token=[^&]+/, "token=[REDACTED]"));
  console.log();
  console.log("Input JSON sent to the actor:");
  console.log(JSON.stringify(body, null, 2));
  console.log();

  const res = await realFetch(input, init);
  const cloned = res.clone();
  const text = await cloned.text();

  console.log("=".repeat(78));
  console.log(`RESPONSE  (HTTP ${res.status})`);
  console.log("=".repeat(78));
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
  console.log();

  return res;
}) as typeof fetch;

/**
 * agent/ cannot import web/src/lib/industries.ts's canonicalIndustry (separate
 * packages, no shared code — Decision #55), so this small table duplicates
 * just the pairs this test actually uses. The point is to make the pairing
 * self-checking rather than two independent hardcoded literals: the ORIGINAL
 * zero-result run happened precisely because `industry` (sent as the actor's
 * free-text searchQuery) and `industryId` disagreed — "B2B SaaS" is not the
 * label LinkedIn's taxonomy uses for id "4" ("Software Development"), so the
 * keyword filter matched nothing even though the structured filters were
 * fine. An assertion here turns a future silent mismatch back into the same
 * loud, obvious failure it should have been the first time.
 */
const KNOWN_INDUSTRY_PAIRS: Record<string, string> = {
  "4": "Software Development",
  "96": "IT Services and IT Consulting",
};

function assertIndustryPairMatches(industryId: string, industry: string): void {
  const expected = KNOWN_INDUSTRY_PAIRS[industryId];
  if (expected === undefined) {
    throw new Error(
      `industryId "${industryId}" isn't in KNOWN_INDUSTRY_PAIRS — add it (with its exact ` +
        `LinkedIn taxonomy label) before running, or this call will likely return zero results.`,
    );
  }
  if (expected !== industry) {
    throw new Error(
      `industry/industryId mismatch: industryId "${industryId}" is "${expected}", but industry ` +
        `is set to "${industry}". These must be the exact same taxonomy entry — the actor's ` +
        `searchQuery is free-text matched against the label, not the id, so a mismatch here is ` +
        `exactly what produced zero results the first time this test was run.`,
    );
  }
}

const QUERY = {
  industry: "Software Development",
  industryId: "4",
  geography: "United States",
  minEmployees: 51,
  maxEmployees: 200,
  companySizeBand: "51-200",
  maxItems: 2,
};

assertIndustryPairMatches(QUERY.industryId, QUERY.industry);

const provider = new ApifyProvider();

console.log(`Calling ${env.apifyActorId} for 2 candidates — this spends real (tiny) money.\n`);

const companies = await provider.search(QUERY);

console.log("=".repeat(78));
console.log(`MAPPED — what discover_companies would write to the candidates table (${companies.length})`);
console.log("=".repeat(78));
console.log(JSON.stringify(companies, null, 2));

process.exit(0);
