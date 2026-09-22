import { createHash } from "node:crypto";
import { db } from "../db.js";
import { env, liveDiscovery } from "../env.js";
import { normalizeDomain, toInt, cleanString } from "../normalize.js";

/**
 * Company discovery. Apify only, per the PRD.
 *
 * The provider is an interface with a fixture implementation so the whole flow
 * is buildable and testable before an actor has been chosen and its pricing
 * confirmed in the Console (Decision #49). Swapping in the live actor is a
 * config change, not a code change.
 */

export type CompanySearchQuery = {
  industry: string;
  geography: string;
  minEmployees: number;
  maxEmployees: number;
  /** The hard cap. Read from the run record by the tool — never from agent input. */
  maxItems: number;
};

export type DiscoveredCompany = {
  companyName: string;
  domain: string | null;
  employeeCount: number | null;
  location: string | null;
  industry: string | null;
  description: string | null;
  raw: Record<string, unknown>;
};

export interface CompanySearchProvider {
  readonly name: string;
  search(query: CompanySearchQuery): Promise<DiscoveredCompany[]>;
}

function queryHash(q: CompanySearchQuery, providerName: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        providerName,
        q.industry.toLowerCase().trim(),
        q.geography.toLowerCase().trim(),
        q.minEmployees,
        q.maxEmployees,
        q.maxItems,
      ]),
    )
    .digest("hex");
}

/** Maps one raw actor record into our shape, tolerating field-name variation. */
function mapRecord(rec: Record<string, unknown>): DiscoveredCompany {
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (rec[k] != null && rec[k] !== "") return rec[k];
    return null;
  };

  const domainRaw = pick("domain", "website", "websiteUrl", "url", "companyWebsite");

  return {
    companyName: cleanString(pick("name", "companyName", "title", "organizationName")) || "(unnamed)",
    domain: normalizeDomain(domainRaw),
    employeeCount: toInt(
      pick("employeeCount", "employees", "employeesCount", "numberOfEmployees", "size"),
    ),
    location: cleanString(pick("location", "country", "hqLocation", "city", "address")) || null,
    industry: cleanString(pick("industry", "sector", "category")) || null,
    description: cleanString(pick("description", "summary", "shortDescription", "about")) || null,
    raw: rec,
  };
}

/**
 * The real actor. maxItems is passed on EVERY run — an uncapped actor input is
 * never constructed anywhere in this file. The token is the team account's,
 * read from the server environment.
 */
class ApifyProvider implements CompanySearchProvider {
  readonly name = "apify";

  async search(query: CompanySearchQuery): Promise<DiscoveredCompany[]> {
    const url =
      `https://api.apify.com/v2/acts/${encodeURIComponent(env.apifyActorId!)}` +
      `/run-sync-get-dataset-items?token=${encodeURIComponent(env.apifyToken!)}`;

    const input = {
      // The cap, under every name actors commonly use for it. Passing all of
      // them is harmless (unknown fields are ignored) and removes the chance
      // of an uncapped run because the actor called it something else.
      maxItems: query.maxItems,
      maxResults: query.maxItems,
      resultsPerSearch: query.maxItems,
      limit: query.maxItems,

      industry: query.industry,
      location: query.geography,
      minEmployees: query.minEmployees,
      maxEmployees: query.maxEmployees,
      searchQuery:
        `${query.industry} companies in ${query.geography} ` +
        `with ${query.minEmployees}-${query.maxEmployees} employees`,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(180_000),
    });

    if (!res.ok) {
      throw new Error(`APIFY_ERROR: actor run failed with ${res.status} ${await res.text()}`);
    }

    const items: unknown = await res.json();
    const list = Array.isArray(items) ? items : [];

    // Belt and braces: even if the actor ignored maxItems, we never return more
    // than was asked for. The tool's own cap is enforced on top of this.
    return list.slice(0, query.maxItems).map((r) => mapRecord(r as Record<string, unknown>));
  }
}

/** Fixture provider. Free, deterministic, and deliberately imperfect. */
class FixtureProvider implements CompanySearchProvider {
  readonly name = "fixture";

  async search(query: CompanySearchQuery): Promise<DiscoveredCompany[]> {
    const { FIXTURE_COMPANIES } = await import("../../fixtures/companies.js");
    return FIXTURE_COMPANIES.slice(0, query.maxItems);
  }
}

export const companySearch: CompanySearchProvider = liveDiscovery
  ? new ApifyProvider()
  : new FixtureProvider();

/**
 * Cached search. Checked before spending: a query already run is returned from
 * Supabase rather than re-billed to the shared budget. This cache is also what
 * makes a retry resume rather than restart.
 */
export async function searchCompaniesCached(
  query: CompanySearchQuery,
): Promise<{ companies: DiscoveredCompany[]; cached: boolean }> {
  const hash = queryHash(query, companySearch.name);

  const { data: hit } = await db
    .from("apify_cache")
    .select("results")
    .eq("query_hash", hash)
    .maybeSingle();

  if (hit) {
    return { companies: hit.results as DiscoveredCompany[], cached: true };
  }

  const companies = await companySearch.search(query);

  await db
    .from("apify_cache")
    .upsert({ query_hash: hash, query: query as unknown as object, results: companies });

  return { companies, cached: false };
}
