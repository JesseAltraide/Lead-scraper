import { z } from "zod";
import { canonicalPlace } from "./geography";
import { canonicalIndustry } from "./industries";

/**
 * Phase 1, Step 1 — the intake form.
 *
 * Everything in this file is checked in code before any AI call: it is free,
 * instant and certain. Spending a Claude call to notice a missing field or
 * min >= max would be waste.
 */

const nonEmpty = (label: string) =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: `${label} is required` });

/** Lists are deduplicated and emptied of blank entries before they are stored. */
const cleanList = z
  .array(z.string())
  .default([])
  .transform((items) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
      const v = raw.trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  });

/**
 * Job titles that say nothing on their own. "Head" and "Director" are not
 * roles — "Head of Operations" is. A persona this vague produces outreach that
 * could be addressed to anyone, which is exactly the generic copy the
 * copywriting guide warns against.
 *
 * Genuinely standalone titles (CEO, CTO, founder) are deliberately NOT here:
 * they identify a role by themselves.
 */
const VAGUE_PERSONAS = new Set([
  "head",
  "heads",
  "lead",
  "leads",
  "leader",
  "manager",
  "director",
  "boss",
  "exec",
  "execs",
  "executive",
  "executives",
  "leadership",
  "management",
  "decision maker",
  "decision makers",
  "decisionmaker",
  "decision-maker",
  "decision-makers",
  "staff",
  "employee",
  "employees",
  "people",
  "team",
  "teams",
  "person",
  "someone",
  "anyone",
  "them",
]);

/** True when the persona is too vague to write outreach for. */
export function isVaguePersona(value: string): boolean {
  const v = value.trim().toLowerCase().replace(/\s+/g, " ");
  return VAGUE_PERSONAS.has(v);
}

export const intakeFormSchema = z
  .object({
    // Industry, geography and company size are AUTOMATIC hard filters — they
    // have their own fields, so they must not also be typed into Must have.
    // Checked against LinkedIn's own industry taxonomy — the search actor
    // filters by numeric industryIds, not free text, and errors outright on
    // an unrecognised one. The stored value is the canonical label; the id
    // itself is resolved separately in icpFromForm.
    industry: nonEmpty("Industry")
      .refine((v) => canonicalIndustry(v) !== null, {
        message:
          "That isn't an industry the search recognises. Try a closer match, like \"Software Development\" or \"IT Services and IT Consulting\".",
      })
      .transform((v) => canonicalIndustry(v)?.label ?? v),
    // Checked against a list of real countries and regions — free, instant and
    // certain, so no AI call is spent discovering that "nowhere" isn't a place.
    // The stored value is canonical ("United States", not "usa"), which the
    // company search then uses as its filter.
    geography: nonEmpty("Geography")
      .refine((v) => canonicalPlace(v) !== null, {
        message:
          "That isn't a place we can search. Use a country or region — for somewhere more specific like a state or city, add it under Must have instead.",
      })
      .transform((v) => canonicalPlace(v) ?? v),
    minEmployees: z.coerce.number().int().positive("Min employees must be a positive whole number"),
    maxEmployees: z.coerce.number().int().positive("Max employees must be a positive whole number"),

    // Who the outreach is written FOR. The agent never searches for people.
    buyerPersona: nonEmpty("Buyer persona").refine((v) => !isVaguePersona(v), {
      message:
        "That's too vague to write to — \"Head\" of what? Try a full title, like \"Head of Operations\" or \"VP of Customer Support\".",
    }),
    businessProblem: nonEmpty("Business problem"),

    mustHave: cleanList,   // extra hard filters beyond industry/geography/size
    niceToHave: cleanList, // affect confidence only, never status
    skipIf: cleanList,     // disqualify only with positive evidence

    leadsWanted: z.coerce.number().int().min(1).max(10).default(10),
    notes: z.string().trim().default(""),
  })
  .refine((v) => v.minEmployees < v.maxEmployees, {
    message: "Min employees must be less than max employees",
    path: ["minEmployees"],
  });

export type IntakeForm = z.infer<typeof intakeFormSchema>;

/**
 * Presented as a dropdown rather than free min/max entry, because the search
 * provider (a LinkedIn company actor) only filters by these exact bands — a
 * typed-in range like "37 to 340" has no matching filter value on their end
 * and would silently fall back to no size filter at all. The stored ICP
 * fields stay numeric (minEmployees/maxEmployees) because qualification
 * compares real evidence against a real number, not a band label.
 */
export const COMPANY_SIZE_BANDS = [
  { label: "1-10", min: 1, max: 10 },
  { label: "11-50", min: 11, max: 50 },
  { label: "51-200", min: 51, max: 200 },
  { label: "201-500", min: 201, max: 500 },
  { label: "501-1000", min: 501, max: 1000 },
  { label: "1001-5000", min: 1001, max: 5000 },
  { label: "5001-10000", min: 5001, max: 10000 },
  { label: "10001+", min: 10001, max: 1_000_000 },
] as const;

export type CompanySizeBand = (typeof COMPANY_SIZE_BANDS)[number]["label"];

/** The band whose min/max exactly matches the ICP's stored range, if any. */
export function companySizeBandFor(minEmployees: number, maxEmployees: number): CompanySizeBand | null {
  const match = COMPANY_SIZE_BANDS.find((b) => b.min === minEmployees && b.max === maxEmployees);
  return match?.label ?? null;
}

/**
 * The finalised ICP written by save_icp. Hard filters are listed explicitly so
 * qualification checks exactly the same things the search filtered on — there
 * is no second, drifted copy of "what counts as strict".
 */
export const HARD_FILTER_KEYS = ["industry", "geography", "company_size"] as const;

export type HardFilter = {
  /** 'industry' | 'geography' | 'company_size' | 'must_have:0' | ... */
  key: string;
  text: string;
};

/**
 * The ICP editor's client-side checks (industryInvalid, sizeInvalid,
 * geographyInvalid) only disable a button — they are not a guarantee on
 * their own. This schema is what the edit_icp/start_research routes
 * actually parse, so it independently re-canonicalises industry and
 * geography and re-derives industryId/companySizeBand from them, rather
 * than trusting whatever the client computed and sent. A direct API call
 * that skips the UI entirely still can't get an invented industry or a
 * mismatched id/band past this.
 */
const icpBaseSchema = z.object({
  industry: nonEmpty("Industry").refine((v) => canonicalIndustry(v) !== null, {
    message:
      "That isn't an industry the search recognises. Try a closer match, like \"Software Development\" or \"IT Services and IT Consulting\".",
  }),
  // Accepted but overwritten below — the server derives this itself.
  industryId: z.string().default(""),
  geography: nonEmpty("Geography").refine((v) => canonicalPlace(v) !== null, {
    message:
      "That isn't a place we can search. Use a country or region — for somewhere more specific like a state or city, add it under Must have instead.",
  }),
  minEmployees: z.number().int().positive(),
  maxEmployees: z.number().int().positive(),
  // Accepted but overwritten below — the server derives this itself.
  companySizeBand: z.string().default(""),
  buyerPersona: z.string().min(1),
  businessProblem: z.string().min(1),
  hardFilters: z.array(z.object({ key: z.string(), text: z.string().min(1) })).min(3),
  niceToHave: z.array(z.string()),
  skipIf: z.array(z.string()),
  notes: z.string().default(""),
});

export const icpSchema = icpBaseSchema
  .refine((v) => v.minEmployees < v.maxEmployees, {
    message: "Min employees must be less than max employees",
    path: ["minEmployees"],
  })
  .refine((v) => companySizeBandFor(v.minEmployees, v.maxEmployees) !== null, {
    message: "That employee range isn't one of the search's fixed size bands.",
    path: ["minEmployees"],
  })
  .transform((v) => {
    // Both guaranteed to resolve here: the refines above already rejected an
    // unmatched industry and a min/max pair that isn't an exact band.
    const industryEntry = canonicalIndustry(v.industry)!;
    const companySizeBand = companySizeBandFor(v.minEmployees, v.maxEmployees)!;
    return { ...v, industry: industryEntry.label, industryId: industryEntry.id, companySizeBand };
  });

export type Icp = z.infer<typeof icpSchema>;

/** Builds the canonical hard-filter list. The three dedicated fields are always present. */
export function buildHardFilters(form: IntakeForm): HardFilter[] {
  return [
    { key: "industry", text: `Industry is ${form.industry}` },
    { key: "geography", text: `Located in ${form.geography}` },
    {
      key: "company_size",
      text: `Between ${form.minEmployees} and ${form.maxEmployees} employees`,
    },
    ...form.mustHave.map((text, i) => ({ key: `must_have:${i}`, text })),
  ];
}

export function icpFromForm(form: IntakeForm): Icp {
  // Both guaranteed to resolve: intakeFormSchema already rejected an
  // industry that canonicalIndustry can't match, and the UI only ever sets
  // minEmployees/maxEmployees together as an exact band pair (see
  // COMPANY_SIZE_BANDS). A miss here means the two have drifted apart, which
  // is a real bug — better to fail loudly than write an id-less ICP that
  // would silently break discovery.
  const industryEntry = canonicalIndustry(form.industry);
  if (!industryEntry) {
    throw new Error(`icpFromForm: "${form.industry}" has no matching industry id`);
  }
  const companySizeBand = companySizeBandFor(form.minEmployees, form.maxEmployees);
  if (!companySizeBand) {
    throw new Error(
      `icpFromForm: ${form.minEmployees}-${form.maxEmployees} doesn't match a known company-size band`,
    );
  }

  return {
    industry: form.industry,
    industryId: industryEntry.id,
    geography: form.geography,
    minEmployees: form.minEmployees,
    maxEmployees: form.maxEmployees,
    companySizeBand,
    buyerPersona: form.buyerPersona,
    businessProblem: form.businessProblem,
    hardFilters: buildHardFilters(form),
    niceToHave: form.niceToHave,
    skipIf: form.skipIf,
    notes: form.notes,
  };
}

/** Strip protocol, `www.`, path and trailing slash; lowercase. Used for dedupe. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^[a-z]+:\/\//, "");
  d = d.split("/")[0];
  d = d.split("?")[0];
  d = d.replace(/^www\./, "");
  d = d.replace(/\.$/, "");
  return d.includes(".") ? d : null;
}
