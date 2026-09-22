import { normalizeDomain, cleanString } from "./normalize.js";

/**
 * Pure scoring and citation logic.
 *
 * Deliberately free of any database or environment import, so it can be tested
 * on its own — without credentials, without a network, and without the rest of
 * the agent being wired up.
 */

// ---------------------------------------------------------------------------
// Confidence: computed here, from the evidence rows. Never supplied by the
// agent. Decision #48 — a self-assessment must not stand in for a real check.
// ---------------------------------------------------------------------------

export function computeConfidence(
  filters: { verdict: string; evidence_kind?: string }[],
  unmetNiceToHave: string[],
): { score: number; basis: string } {
  const confirmed = filters.filter((f) => f.verdict === "confirmed");
  const inferred = confirmed.filter((f) => f.evidence_kind === "inferred").length;
  const unknown = filters.filter((f) => f.verdict === "unknown").length;
  const failed = filters.filter((f) => f.verdict === "failed").length;

  let score = 100;
  score -= 25 * inferred;
  score -= 25 * unknown;
  score -= 25 * failed;
  score -= 10 * unmetNiceToHave.length;
  score = Math.max(0, Math.min(100, score));

  const parts = [
    `${confirmed.length - inferred}/${filters.length} hard filters confirmed by direct source text`,
  ];
  if (inferred) parts.push(`${inferred} confirmed by inference only (−${25 * inferred})`);
  if (unknown) parts.push(`${unknown} unknown (−${25 * unknown})`);
  if (failed) parts.push(`${failed} failed (−${25 * failed})`);
  if (unmetNiceToHave.length)
    parts.push(`${unmetNiceToHave.length} nice-to-have not met (−${10 * unmetNiceToHave.length})`);

  return { score, basis: parts.join("; ") };
}

// ---------------------------------------------------------------------------
// Citation check: run in code after generation AND after every rewrite. An
// instruction in a prompt is not a guarantee.
// ---------------------------------------------------------------------------

export function checkCitation(
  citationFact: string,
  citationSourceUrl: string | null,
  allowedSourceUrls: string[],
  sourceSummary: string,
): { ok: true } | { ok: false; reason: string } {
  const fact = cleanString(citationFact);
  if (fact.length < 10) {
    return { ok: false, reason: "citation_fact is missing or too short to be a real citation" };
  }

  if (citationSourceUrl) {
    const norm = normalizeDomain(citationSourceUrl);
    const allowed = allowedSourceUrls.map(normalizeDomain).filter(Boolean);
    if (!allowed.includes(norm)) {
      return {
        ok: false,
        reason: `citation_source_url ${citationSourceUrl} is not one of this lead's source URLs`,
      };
    }
    return { ok: true };
  }

  // No URL given: the cited fact must at least be traceable to the stored
  // source summary, so a reviewer can check it.
  const words = fact.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
  const haystack = sourceSummary.toLowerCase();
  const overlap = words.filter((w) => haystack.includes(w)).length;
  if (words.length > 0 && overlap === 0) {
    return {
      ok: false,
      reason:
        "citation_fact has no overlap with the lead's source summary and no source URL — it cannot be checked against anything",
    };
  }
  return { ok: true };
}
