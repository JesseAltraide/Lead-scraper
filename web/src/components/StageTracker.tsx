import type { RunStatus } from "@/lib/runStates";

/**
 * A non-spinner progress indicator for the long wait between screening a
 * discovered company, reading its website, qualifying the lead it came from,
 * and writing that lead's outreach drafts. A single spinner or "working"
 * banner gave no sense of which of those four stages was actually happening,
 * which read as the process being stuck even when it wasn't.
 *
 * Highlights the FURTHEST stage the run has reached so far, not only the
 * instantaneous `active_tool`, screening, once it starts, stays highlighted
 * through the gaps between tool calls (discovering) until reading actually
 * begins, and so on. A live `active_tool` match for a later stage always
 * wins (it is proof positive that stage has started, even before its own
 * row/count has landed).
 */

type Stage = "searching" | "screening" | "reading" | "qualifying" | "drafting";

const STAGE_ORDER: { key: Stage; label: string; tools: string[] }[] = [
  { key: "searching", label: "Searching for candidates", tools: ["discover_companies"] },
  { key: "screening", label: "Screening companies", tools: ["screen_candidates"] },
  { key: "reading", label: "Reading websites", tools: ["scrape_website"] },
  { key: "qualifying", label: "Qualifying leads", tools: ["save_lead_qualification"] },
  { key: "drafting", label: "Writing drafts", tools: ["save_outreach_draft"] },
];

function furthestStage(
  activeTool: string | null,
  hasSearched: boolean,
  hasScreened: boolean,
  hasScraped: boolean,
  hasQualified: boolean,
  hasDrafted: boolean,
): Stage | null {
  const liveStage = STAGE_ORDER.find((s) => activeTool && s.tools.includes(activeTool))?.key;
  if (hasDrafted || liveStage === "drafting") return "drafting";
  if (hasQualified || liveStage === "qualifying") return "qualifying";
  if (hasScraped || liveStage === "reading") return "reading";
  if (hasScreened || liveStage === "screening") return "screening";
  if (hasSearched || liveStage === "searching") return "searching";
  return null;
}

export function StageTracker({
  status,
  activeTool,
  hasSearched,
  hasScreened,
  hasScraped,
  hasQualified,
  hasDrafted,
  draftsProgress,
}: {
  status: RunStatus;
  activeTool: string | null;
  hasSearched: boolean;
  hasScreened: boolean;
  hasScraped: boolean;
  hasQualified: boolean;
  hasDrafted: boolean;
  /**
   * How many qualified leads have all four outreach pieces written, out of
   * how many qualified leads exist right now. Leads aren't visible for
   * review until the run itself finishes (the "researching" status offers no
   * "See the leads" action at all — see runStates.ts), so without this the
   * whole drafting stage was a single dot with no sense of progress through
   * what can be the longest step (up to 4 Claude calls per qualified lead).
   * null when there is nothing qualified yet to draft for.
   */
  draftsProgress: { leadsDone: number; leadsTotal: number } | null;
}) {
  if (status !== "researching") return null;

  const active = furthestStage(activeTool, hasSearched, hasScreened, hasScraped, hasQualified, hasDrafted);
  const activeLabel = STAGE_ORDER.find((s) => s.key === active)?.label;

  return (
    <div className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      {/* The colored dot and text-color shift are visual-only. A screen
          reader needs an explicit announcement when the stage changes,
          the whole point of this component is to say what's happening. */}
      <span className="sr-only" role="status" aria-live="polite">
        {active === "drafting" && draftsProgress
          ? `${activeLabel}: ${draftsProgress.leadsDone} of ${draftsProgress.leadsTotal} leads done`
          : (activeLabel ?? "Working")}
      </span>
      {/* Visual-only from here down — the sr-only status span above is what
          assistive tech actually hears, so this whole row is hidden from it
          to avoid reading every label twice. */}
      {STAGE_ORDER.map((stage, i) => {
        const isActive = stage.key === active;
        return (
          <div key={stage.key} className="flex flex-1 items-center gap-2" aria-hidden="true">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${isActive ? "animate-pulse" : ""}`}
                style={{ background: isActive ? "var(--accent)" : "var(--border-strong)" }}
              />
              <span
                className="text-xs font-medium"
                style={{ color: isActive ? "var(--text)" : "var(--text-faint)" }}
              >
                {stage.label}
                {stage.key === "drafting" && draftsProgress
                  ? ` (${draftsProgress.leadsDone} of ${draftsProgress.leadsTotal})`
                  : null}
              </span>
            </div>
            {i < STAGE_ORDER.length - 1 ? (
              <span
                className="h-px flex-1"
                style={{ background: "var(--border)" }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
