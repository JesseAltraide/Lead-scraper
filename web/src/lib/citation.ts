/**
 * Citation check for outreach drafts — ported from `agent/src/scoring.ts`'s
 * `checkCitation`, not imported: `web` and `agent` are separate processes with
 * no shared package (CLAUDE.md). Kept logically identical because the rule is
 * the same rule wherever a draft is produced — the initial agent-written
 * draft (checked there) and a web-side rewrite (checked here) must pass the
 * same bar, per full-flow.md: "A rewritten personalization must still cite a
 * source. Checked programmatically after generation."
 *
 * Deliberately NOT used for direct edits — full-flow.md is explicit that an
 * edit gets no AI check afterwards ("the person editing *is* the reviewer").
 */

function cleanString(input: unknown): string {
  if (input == null) return "";
  const s = typeof input === "string" ? input : String(input);
  return s.trim();
}

function normalizeDomain(input: unknown): string | null {
  const raw = cleanString(input).toLowerCase();
  if (!raw) return null;
  let d = raw.replace(/^[a-z]+:\/\//, "");
  d = d.split("/")[0] ?? "";
  d = d.split("?")[0] ?? "";
  d = d.replace(/^www\./, "").replace(/\.$/, "");
  return d.includes(".") ? d : null;
}

export function checkCitation(
  citationFact: string,
  citationSourceUrl: string | null,
  allowedSourceUrls: string[],
  sourceSummary: string,
): { ok: true } | { ok: false; reason: string } {
  const fact = cleanString(citationFact);
  if (fact.length < 10) {
    return { ok: false, reason: "That personalization is missing or too short to be a real citation." };
  }

  if (citationSourceUrl) {
    const norm = normalizeDomain(citationSourceUrl);
    const allowed = allowedSourceUrls.map(normalizeDomain).filter(Boolean);
    if (!allowed.includes(norm)) {
      return {
        ok: false,
        reason: `${citationSourceUrl} isn't one of this lead's source URLs.`,
      };
    }
    return { ok: true };
  }

  const words = fact.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
  const haystack = sourceSummary.toLowerCase();
  const overlap = words.filter((w) => haystack.includes(w)).length;
  if (words.length > 0 && overlap === 0) {
    return {
      ok: false,
      reason:
        "That personalization has no overlap with the lead's source summary and no source URL — it can't be checked against anything.",
    };
  }
  return { ok: true };
}
