/**
 * Shared between the run page (a lightweight summary) and the dedicated
 * leads page (the full three-tab review) — extracted so both read the same
 * labels/tones for the same underlying enum values rather than risking two
 * copies drifting apart.
 */

/** Matches lead_filter_results (supabase/migrations/0001_init.sql) exactly. */
export type FilterResult = {
  lead_id: string;
  filter_key: string;
  filter_text: string;
  verdict: "confirmed" | "failed" | "unknown";
  evidence: string | null;
  evidence_source_url: string | null;
  evidence_kind: "direct" | "inferred" | "none";
};

export const VERDICT_LABEL: Record<FilterResult["verdict"], string> = {
  confirmed: "Confirmed",
  failed: "Failed",
  unknown: "Unknown",
};

export const VERDICT_TONE: Record<FilterResult["verdict"], string> = {
  confirmed: "done",
  failed: "error",
  unknown: "waiting",
};

/** Matches lead_status (supabase/migrations/0001_init.sql). */
export const LEAD_TABS = ["qualified", "needs_review", "not_qualified"] as const;
export type LeadTab = (typeof LEAD_TABS)[number];

export const LEAD_LABEL: Record<LeadTab, string> = {
  qualified: "Good fit",
  needs_review: "Couldn't fully check",
  not_qualified: "Not a fit",
};

export const LEAD_TONE: Record<LeadTab, string> = {
  qualified: "done",
  needs_review: "waiting",
  not_qualified: "neutral",
};

/** The tab label used on the leads page itself (deliberately plainer than the
 * per-lead badge text above — "not sure" reads better as a tab than as a
 * verdict on an individual company). */
export const TAB_LABEL: Record<LeadTab, string> = {
  qualified: "Qualified",
  needs_review: "Not sure",
  not_qualified: "Not qualified",
};
