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
  /** The actor's own numeric industry id, e.g. "4" for Software Development. */
  industryId: string;
  geography: string;
  minEmployees: number;
  maxEmployees: number;
  /** The actor's own band string, e.g. "11-50" — not a min/max pair. */
  companySizeBand: string;
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
        q.industryId,
        q.geography.toLowerCase().trim(),
        q.minEmployees,
        q.maxEmployees,
        q.companySizeBand,
        q.maxItems,
      ]),
    )
    .digest("hex");
}

/**
 * The confirmed actor's location is an array of office records, not a flat
 * field — `[{ country, city, headquarter: boolean, parsed: {...} }]`. Prefer
 * the entry actually marked headquarters (a company can list a dozen
 * branches); fall back to the first entry if none is marked, rather than
 * dropping location entirely.
 */
function pickLocationFromArray(rec: Record<string, unknown>): string | null {
  const locations = rec["locations"];
  if (!Array.isArray(locations) || locations.length === 0) return null;

  const hq =
    (locations.find((l) => (l as Record<string, unknown>)?.["headquarter"] === true) ??
      locations[0]) as Record<string, unknown>;
  const parsed = (hq["parsed"] ?? {}) as Record<string, unknown>;

  const city = parsed["city"] ?? hq["city"];
  const country = parsed["countryFull"] ?? parsed["country"] ?? hq["country"];
  const parts = [city, country].filter((p): p is string => typeof p === "string" && p.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** The confirmed actor's industry is `[{ id, name }]`, not a flat field. */
function pickIndustryFromArray(rec: Record<string, unknown>): string | null {
  const industries = rec["industries"];
  if (!Array.isArray(industries) || industries.length === 0) return null;
  const name = (industries[0] as Record<string, unknown>)?.["name"];
  return typeof name === "string" && name.length > 0 ? name : null;
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
    // Try the array shape the confirmed actor actually returns first; the
    // flat-key guesses stay as a fallback for the fixture provider and any
    // future actor swap that does use flat fields.
    location:
      pickLocationFromArray(rec) ??
      (cleanString(pick("location", "country", "hqLocation", "city", "address")) || null),
    industry:
      pickIndustryFromArray(rec) ?? (cleanString(pick("industry", "sector", "category")) || null),
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

    // The actor's confirmed real input shape — verified against a live test
    // call, not guessed. companySize and industryIds are the actor's own
    // fixed values (a band string, a numeric id as a string), not the
    // min/max pair or free-text industry name the rest of this codebase
    // otherwise uses.
    const input = {
      companySize: [query.companySizeBand],
      industryIds: [query.industryId],
      locations: [query.geography],
      maxItems: query.maxItems,
      scraperMode: "full",
      // Soft signal only — the actor matches this against a company's own
      // description, not the problem a prospect has, so keeping it to the
      // industry label avoids the query pointing at competitors instead of
      // prospects. See progress.md for the fuller reasoning.
      searchQuery: query.industry,
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
