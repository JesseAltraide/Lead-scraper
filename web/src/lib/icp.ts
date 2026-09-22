import { z } from "zod";

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

export const intakeFormSchema = z
  .object({
    // Industry, geography and company size are AUTOMATIC hard filters — they
    // have their own fields, so they must not also be typed into Must have.
    industry: nonEmpty("Industry"),
    geography: nonEmpty("Geography"),
    minEmployees: z.coerce.number().int().positive("Min employees must be a positive whole number"),
    maxEmployees: z.coerce.number().int().positive("Max employees must be a positive whole number"),

    // Who the outreach is written FOR. The agent never searches for people.
    buyerPersona: nonEmpty("Buyer persona"),
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

export const icpSchema = z.object({
  industry: z.string().min(1),
  geography: z.string().min(1),
  minEmployees: z.number().int().positive(),
  maxEmployees: z.number().int().positive(),
  buyerPersona: z.string().min(1),
  businessProblem: z.string().min(1),
  hardFilters: z.array(z.object({ key: z.string(), text: z.string().min(1) })).min(3),
  niceToHave: z.array(z.string()),
  skipIf: z.array(z.string()),
  notes: z.string().default(""),
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
  return {
    industry: form.industry,
    geography: form.geography,
    minEmployees: form.minEmployees,
    maxEmployees: form.maxEmployees,
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
