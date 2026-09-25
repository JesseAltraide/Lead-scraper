import { Badge } from "@/components/ui";
import { DraftReview } from "@/components/DraftReview";
import { GenerateDraftsButton } from "@/components/GenerateDraftsButton";
import { VERDICT_LABEL, VERDICT_TONE, type FilterResult } from "@/lib/leadDisplay";
import { PIECE_KEYS, type DraftPiece, type DraftVersion } from "@/lib/drafts";

// source_urls came from a scraped website via the agent, not from a user or
// this app — untrusted, per CLAUDE.md. Only ever render it as a clickable
// href when it actually parses as http(s); a javascript: or data: URL sitting
// in scraped text must never become a clickable link.
function safeHttpUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
  } catch {
    return undefined;
  }
  return undefined;
}

type Lead = {
  id: string;
  company_name: string;
  domain: string;
  status: string;
  confidence: number;
  confidence_basis: string;
  fit_reasons: string[];
  concerns: string[];
  source_urls: string[];
  source_summary: string;
};

/**
 * One lead's full review: the summary line, the Evidence panel (source
 * summary, source URLs, per-hard-filter verdict — Phase 7's "everything the
 * agent saw"), and — for qualified leads only — the Outreach drafts panel.
 *
 * Extracted from the run page so it can be reused by the dedicated leads page
 * (three tabs: Qualified / Not sure / Not qualified) without duplicating this
 * markup — the run page itself now only shows a summary and a link here,
 * which is what actually fixes the page getting overloaded with many leads.
 */
export function LeadRow({
  runId,
  lead,
  filters,
  pieces,
  versionsByPiece,
}: {
  runId: string;
  lead: Lead;
  filters: FilterResult[];
  pieces: DraftPiece[];
  versionsByPiece: Record<string, DraftVersion[]>;
}) {
  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lead.company_name}</p>
          <p className="truncate text-xs text-[var(--text-muted)]">{lead.confidence_basis}</p>
        </div>
        <span className="text-sm tabular-nums text-[var(--text-muted)]">{lead.confidence}</span>
      </div>

      <details className="border-t border-[var(--border)]">
        <summary className="cursor-pointer px-5 py-2 text-xs font-medium text-[var(--text-muted)]">
          Evidence
        </summary>
        <div className="space-y-3 px-5 py-3 text-xs">
          <p className="text-[var(--text-muted)]">{lead.source_summary}</p>
          {lead.source_urls.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {lead.source_urls.map((u) => {
                // "Not sure" leads above 50 confidence are worth a look — link
                // out so the reviewer can decide for themselves rather than
                // rely only on the agent's evidence summary. Below that, or on
                // any other tab, this stays plain text. safeHttpUrl guards
                // against a non-http(s) scheme reaching href from scraped text.
                const href =
                  lead.status === "needs_review" && lead.confidence > 50 ? safeHttpUrl(u) : undefined;
                return href ? (
                  <li key={u}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
                    >
                      {u}
                    </a>
                  </li>
                ) : (
                  <li
                    key={u}
                    className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[var(--text-muted)]"
                  >
                    {u}
                  </li>
                );
              })}
            </ul>
          ) : null}

          <ul className="space-y-1.5">
            {filters.map((f) => (
              <li
                key={f.filter_key}
                className="rounded-[8px] border border-[var(--border-strong)] px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{f.filter_text}</span>
                  <Badge tone={VERDICT_TONE[f.verdict]}>{VERDICT_LABEL[f.verdict]}</Badge>
                </div>
                {f.evidence ? (
                  <p className="mt-1 text-[var(--text-muted)]">
                    {f.evidence}
                    {f.evidence_source_url ? ` (${f.evidence_source_url})` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          {lead.fit_reasons.length > 0 ? (
            <p>
              <span className="font-medium">Fit: </span>
              {lead.fit_reasons.join("; ")}
            </p>
          ) : null}
          {lead.concerns.length > 0 ? (
            <p>
              <span className="font-medium">Concerns: </span>
              {lead.concerns.join("; ")}
            </p>
          ) : null}
        </div>
      </details>

      {/* Any lead with a draft shows the panel, regardless of status. */}
      {pieces.length > 0 ? (
        <details className="border-t border-[var(--border)] bg-[var(--surface-2)]">
          <summary className="cursor-pointer px-5 py-2 text-xs font-medium text-[var(--text-muted)]">
            Outreach drafts
          </summary>
          <DraftReview
            runId={runId}
            leadId={lead.id}
            pieces={pieces}
            versionsByPiece={versionsByPiece}
          />
        </details>
      ) : null}

      {/* Drafting for qualified/needs_review is required or optional
          respectively, never automatic on the leads page itself — this is the
          manual trigger for a lead still missing at least one piece, whether
          because the agent judged a needs_review lead not worth drafting for,
          or a qualified lead ran short when the run's budget ran out first. */}
      {lead.status !== "not_qualified" && pieces.length < PIECE_KEYS.length ? (
        <GenerateDraftsButton runId={runId} leadId={lead.id} />
      ) : null}
    </li>
  );
}
