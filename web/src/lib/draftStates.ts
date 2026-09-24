/**
 * THE draft-piece states, as code — the same idea as runStates.ts, for the one
 * part of the app that did not have it.
 *
 * Why this exists: the review screen decided whether a rewrite was possible
 * with an inline boolean (`rewrites_requested >= 3 || rewrite_in_flight`)
 * while the database decided it with a different rule (migration 0008 also
 * allows reclaiming a claim older than the stale window). Those two rules
 * drifted, and a rewrite that died mid-flight left a button disabled forever
 * even though the backend would have accepted a new one — a dead end produced
 * by exactly the "two places decide the same thing" pattern runStates.ts was
 * written to kill.
 *
 * So: one function, consulted by the screen AND by the routes. If they ever
 * disagree again it is because someone edited this file, not because two
 * copies of a rule fell out of sync.
 */

/** Matches the cap in claim_rewrite_slot. */
export const MAX_REWRITES = 3;

/**
 * When a stuck rewrite may be cancelled by hand. The rewrite call itself is
 * capped at 60s by an AbortSignal, so a slot still in flight after two minutes
 * is certainly orphaned and releasing it is safe. This is what stops a user
 * waiting on a dead button for the database's much longer reclaim window.
 */
export const CANCELLABLE_AFTER_MS = 2 * 60_000;

export type DraftPieceState = {
  rewritesRequested: number;
  rewriteInFlight: boolean;
  /** ISO timestamp, or null for a slot claimed before 0008 added the column. */
  rewriteClaimedAt: string | null;
};

export type RewritePhase =
  /** Nothing in flight and the cap has room. */
  | "ready"
  /** A rewrite is genuinely running right now. */
  | "running"
  /** In flight long enough that whatever started it is gone. */
  | "abandoned"
  /** All three rewrites used. */
  | "capped";

/**
 * `now` is required and may be null, deliberately — there is no Date.now()
 * default. Reading the clock during a React render is impure (and would let
 * the server's HTML and the browser's hydration disagree across the two-minute
 * boundary), so the screen passes null until it has mounted and the API routes
 * pass a real timestamp. Null means "clock unknown", which resolves to the
 * safe answer: still running, nothing offered that could be wrong.
 */
export function rewritePhase(state: DraftPieceState, now: number | null): RewritePhase {
  if (state.rewriteInFlight) {
    const claimedAt = state.rewriteClaimedAt ? Date.parse(state.rewriteClaimedAt) : null;
    // A null/unparseable timestamp cannot be aged either, so it lands in the
    // same safe answer and leaves the database's own reclaim as the backstop.
    if (now === null || claimedAt === null || Number.isNaN(claimedAt)) return "running";
    return now - claimedAt >= CANCELLABLE_AFTER_MS ? "abandoned" : "running";
  }
  return state.rewritesRequested >= MAX_REWRITES ? "capped" : "ready";
}

export type DraftActionId = "rewrite" | "cancel_rewrite" | "edit";

export type DraftActionAvailability = {
  available: boolean;
  /**
   * Why not — and, always, what to do instead. A refusal that does not name a
   * next step is the failure this whole file exists to prevent.
   */
  reason?: string;
};

/**
 * The one place that decides what can be done to a draft piece right now.
 * Both the screen and the API routes call this.
 */
export function draftActionAvailability(
  action: DraftActionId,
  state: DraftPieceState,
  now: number | null,
): DraftActionAvailability {
  const phase = rewritePhase(state, now);

  // Editing is always possible. It costs nothing, needs no slot, and is the
  // fallback every other refusal below points at — so it must never be blocked.
  if (action === "edit") return { available: true };

  if (action === "cancel_rewrite") {
    if (phase === "abandoned") return { available: true };
    if (phase === "running") {
      return {
        available: false,
        reason:
          "This rewrite is still running. It stops on its own within a minute — wait for it to finish or fail, then you can cancel or retry it.",
      };
    }
    return { available: false, reason: "There is no rewrite in progress to cancel." };
  }

  // action === "rewrite"
  if (phase === "ready") return { available: true };

  if (phase === "capped") {
    return {
      available: false,
      reason: `All ${MAX_REWRITES} rewrites for this piece are used. You can still edit it directly — your edit is saved as a new version, and the earlier ones are kept.`,
    };
  }

  if (phase === "running") {
    return {
      available: false,
      reason:
        "A rewrite for this piece is already running. Wait for it to finish — if it fails, you'll be able to cancel it and try again.",
    };
  }

  // phase === "abandoned": the previous attempt is gone. The database reclaims
  // the slot itself once past its own stale window, but until then the honest
  // instruction is to cancel it, which frees it immediately.
  return {
    available: false,
    reason:
      "The last rewrite didn't finish. Cancel it to free this piece up — that gives the rewrite back, so you don't lose one of your three.",
  };
}
