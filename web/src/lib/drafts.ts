/**
 * Phase 5 — outreach drafts. Shared types/constants between the review screen
 * and its API routes, matching `draft_pieces`/`draft_versions` exactly
 * (supabase/migrations/0001_init.sql, 0002_guards.sql).
 */

/**
 * No em dashes anywhere the model writes text — house rule for this project,
 * not just a style preference for code/comments. Mirrors the identical
 * stripping the agent's own draft-writing path already applies in
 * `agent/src/normalize.ts`'s `cleanString`; this route and the rewrite route
 * are a SEPARATE Claude call (the web app's own on-demand drafting for
 * needs_review leads and rewrites), so they need their own copy rather than
 * relying on the system prompt alone — an instruction is not a guarantee.
 */
export function stripEmDashes(input: string): string {
  return input.replace(/\s+—\s+/g, ", ").replace(/—/g, " - ");
}

export const PIECE_KEYS = ["email_1", "email_2", "email_3", "linkedin"] as const;
export type PieceKey = (typeof PIECE_KEYS)[number];

export const PIECE_LABELS: Record<PieceKey, string> = {
  email_1: "Email 1",
  email_2: "Email 2 (follow-up)",
  email_3: "Email 3 (final follow-up)",
  linkedin: "LinkedIn message",
};

// MAX_REWRITES deliberately lives in draftStates.ts, next to the rules that
// use it. Keeping a second copy here is how the UI and the backend drifted
// apart in the first place.

export type DraftVersion = {
  id: string;
  piece_id: string;
  subject: string | null;
  body: string;
  personalization_note: string;
  citation_source_url: string | null;
  citation_fact: string;
  origin: "initial" | "rewrite" | "edit";
  rewrite_note: string | null;
  is_chosen: boolean;
  reviewed: boolean;
  created_at: string;
};

export type DraftPiece = {
  id: string;
  lead_id: string;
  piece_key: PieceKey;
  rewrites_requested: number;
  rewrite_in_flight: boolean;
  /** Needed to tell a running rewrite from an abandoned one, see draftStates.ts. */
  rewrite_claimed_at: string | null;
  edits_requested: number;
};

/** One version's position among its siblings, oldest first — for "Version X of Y". */
export function versionIndex(versions: DraftVersion[], versionId: string): { index: number; total: number } {
  const ordered = [...versions].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { index: ordered.findIndex((v) => v.id === versionId) + 1, total: ordered.length };
}
