import { normalizeDomain, toInt, cleanString } from "../normalize.js";
import type { DiscoveredCompany } from "./companySearch.js";

/**
 * Pure mapping from one raw actor record to our DiscoveredCompany shape.
 *
 * Deliberately free of any env/db import (companySearch.ts imports env.ts,
 * which requires real credentials at module load) so this can be tested
 * without standing up the rest of the agent — same reasoning as the
 * tools.ts/scoring.ts split.
 */

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

/**
 * The confirmed actor gives headcount two ways, and they can DISAGREE within
 * the same record: a real live call returned one company with only
 * `employeeCountRange: {start:51,end:200}` (no flat field at all — mapping
 * this straight to `employeeCount` silently produced null), and another with
 * BOTH a flat `employeeCount: 37` and `employeeCountRange: {start:51,end:200}`
 * pointing at different numbers entirely.
 *
 * `employeeCountRange` is LinkedIn's own displayed bucket (what a human sees
 * on the company page) and is present far more often; the flat field looks
 * like a separately-scraped, less reliable estimate. So the range is
 * preferred, using its midpoint as the single comparable number the rest of
 * this codebase expects — falling back to the flat field only when no range
 * is present at all.
 */
function pickEmployeeCount(rec: Record<string, unknown>): number | null {
  const range = rec["employeeCountRange"] as Record<string, unknown> | undefined;
  if (range && typeof range === "object") {
    const start = toInt(range["start"]);
    const end = toInt(range["end"]);
    if (start != null && end != null) return Math.round((start + end) / 2);
    if (start != null) return start;
    if (end != null) return end;
  }
  return toInt(
    rec["employeeCount"] ?? rec["employees"] ?? rec["employeesCount"] ?? rec["numberOfEmployees"] ?? rec["size"],
  );
}

/** Maps one raw actor record into our shape, tolerating field-name variation. */
export function mapRecord(rec: Record<string, unknown>): DiscoveredCompany {
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (rec[k] != null && rec[k] !== "") return rec[k];
    return null;
  };

  const domainRaw = pick("domain", "website", "websiteUrl", "url", "companyWebsite");

  return {
    companyName: cleanString(pick("name", "companyName", "title", "organizationName")) || "(unnamed)",
    domain: normalizeDomain(domainRaw),
    // Try the range-based shape the confirmed actor actually returns first;
    // the flat-key guess stays as a fallback for the fixture provider and any
    // future actor swap that does use a single flat field.
    employeeCount: pickEmployeeCount(rec),
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
