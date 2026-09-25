/**
 * The rules for Phase 1's form check — the prompt, the parsing, and the
 * blocker-resolution test.
 *
 * Deliberately free of any database or server-only import, so the behaviour
 * can be exercised directly in a test without standing up Next.js.
 */

export type ClarificationItem = {
  kind: "blocker" | "question";
  /** The form fields involved. A blocker names the ones that conflict. */
  fields: string[];
  question: string;
  why?: string;
};

export const CLARIFIABLE_FIELDS = [
  "industry",
  "geography",
  "minEmployees",
  "maxEmployees",
  "buyerPersona",
  "businessProblem",
  "mustHave",
  "niceToHave",
  "skipIf",
  // The intake form's free-text "Anything else" field. Missing here meant a
  // real contradiction naming this field (e.g. Geography "United States"
  // with a note saying "based in Germany") still got correctly detected by
  // the model, but parseFindings' isClarifiableField filter silently dropped
  // "notes" out of the blocker's `fields` array before it ever reached the
  // UI — leaving only the OTHER field editable, with no way to resolve the
  // blocker by fixing the side that was actually wrong.
  "notes",
] as const;

export type ClarifiableField = (typeof CLARIFIABLE_FIELDS)[number];

export function isClarifiableField(v: unknown): v is ClarifiableField {
  return typeof v === "string" && (CLARIFIABLE_FIELDS as readonly string[]).includes(v);
}

export const SYSTEM = [
  "You check a lead-research intake form before any paid company search runs.",
  "",
  "The form describes companies to find, and a buyer persona the outreach will be",
  "written to. The persona is NEVER searched for — only companies are.",
  "",
  "Return findings of exactly two kinds.",
  "",
  "BLOCKER — two or more answers contradict each other, so no company could satisfy",
  "both at once. The user cannot explain this away; a field has to change. Examples:",
  '  · Industry "B2B SaaS" with buyer persona "Head of School" — a Head of School works',
  "    at a school, not at a SaaS company. Either the industry is education, or the",
  "    persona is a role inside the SaaS company (VP of Sales, Head of Partnerships).",
  '  · Size "10-100 employees" with "Skip if: startups and small companies".',
  '  · Geography "Germany" with "Must have: headquartered in the United States".',
  '  · Geography "United States" with a must-have, nice-to-have, or skip-if that names a',
  '    SPECIFIC PLACE (city, region) that is only in a different country — e.g. "Must have:',
  '    based in Manchester" is a BLOCKER against geography "United States" only once you are',
  "    sure the place named is the one abroad. Many place names exist in more than one",
  '    country (Manchester is both a UK city AND a city in New Hampshire; there is also a',
  '    Paris, Texas; a Birmingham, Alabama). When the named place is genuinely ambiguous',
  "    between the stated geography and elsewhere, this is NOT a confident BLOCKER — raise",
  '    it as a QUESTION instead, asking the user to confirm which place they meant, since',
  "    calling it a contradiction outright could be wrong.",
  '  · Industry "Healthcare" with a must-have, nice-to-have, or skip-if that names a',
  '    DIFFERENT industry outright (e.g. "Must have: is a law firm", or "Skip if: not a',
  "    restaurant\" under industry \"Retail\"). A must/nice/skip that's merely a narrower",
  "    slice of the same industry is fine and not a contradiction (\"Must have: sells",
  '    direct-to-consumer" under industry "Retail" is a normal filter, not a conflict).',
  "List every field involved in `fields` so the user can change whichever they meant.",
  "",
  "QUESTION — an answer is too vague to search, asks for something no company database",
  "or public website could confirm, OR reads as garbled/incoherent English rather than a",
  "real sentence — words run together with no spaces, or the grammar doesn't parse at",
  "all. The user can resolve any of these by explaining or retyping. Examples:",
  '  · Industry "tech" — too broad to search.',
  '  · Must have "has budget approved this quarter" — nothing public could confirm it.',
  '  · Business problem "Help the schoolmanage their schoolsystem end to end" — words run',
  "    together with no spaces; ask what it's actually meant to say. A free-text field",
  "    with a spelling slip or informal phrasing is fine; this is specifically about text",
  "    that doesn't parse as English at all, not about polish.",
  '  · Business problem "We will improve your runtime by 50%" — a bare outcome claim with',
  '    no mechanism behind it. Ask HOW: "How do you plan on doing that?" The answer is what',
  "    the drafted outreach will actually cite, a number with no method behind it gives the",
  "    agent nothing concrete to write about the value delivered. This applies to any",
  "    business problem that states a quantified or dramatic result (a percentage, a time",
  '    savings, "eliminate", "double") without saying what actually produces it — it does',
  "    NOT apply to a business problem that already names the mechanism (\"We cut runtime by",
  '    50% by rewriting the scheduler in Rust" needs no question, the how is already there).',
  "",
  "Be strict about contradictions and relaxed about everything else. A form does not",
  "have to be ideal, only searchable. Do NOT reclassify the user's own hard/soft/skip",
  "choices — they stated those deliberately. Do not raise a BLOCKER unless the conflict",
  "is genuine and obvious; a merely unusual combination is not a contradiction.",
  "",
  "Never raise a QUESTION about the buyer persona's specificity ('Decision makers' is",
  "too vague, name an actual title) — that check already runs in code before this ever",
  "sees the form, and a persona that reached you already passed it. Only mention",
  "buyerPersona at all when it is one side of a genuine BLOCKER against another field",
  "(the Head of School / B2B SaaS example above) — never as a standalone finding.",
  "",
  "Reply with JSON only:",
  '{"ok": boolean, "findings": [{"kind": "blocker"|"question", "fields": [string],',
  ' "question": string, "why": string}]}',
  "",
  `Valid field names: ${CLARIFIABLE_FIELDS.join(", ")}.`,
  "If the form is workable, return ok:true with an empty findings array.",
].join("\n");

/** Normalises whatever the model returns into items we can render and enforce. */
export function parseFindings(raw: unknown): ClarificationItem[] {
  if (!Array.isArray(raw)) return [];

  const items: ClarificationItem[] = [];
  for (const entry of raw.slice(0, 5)) {
    if (typeof entry !== "object" || !entry) continue;
    const e = entry as Record<string, unknown>;

    const fields = (Array.isArray(e.fields) ? e.fields : [e.field])
      .filter(isClarifiableField)
      .slice(0, 3);

    const question = typeof e.question === "string" ? e.question.trim() : "";
    if (!question || fields.length === 0) continue;

    items.push({
      // Anything not explicitly a blocker is treated as a question — the
      // weaker, non-blocking classification is the safe default.
      kind: e.kind === "blocker" ? "blocker" : "question",
      fields,
      question,
      why: typeof e.why === "string" ? e.why.trim() : undefined,
    });
  }
  return items;
}

/**
 * Has a blocker actually been resolved? Compares the submitted value of each
 * conflicting field against what was stored.
 *
 * This is the enforcement. Without it a blocker is just a strongly-worded
 * question, and the user can press on with a search that cannot succeed.
 */
export function blockerResolved(
  item: ClarificationItem,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  return item.fields.some((f) => normalise(before[f]) !== normalise(after[f]));
}

function normalise(v: unknown): string {
  if (Array.isArray(v)) {
    return v
      .map((x) => String(x).trim().toLowerCase())
      .sort()
      .join("|");
  }
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
