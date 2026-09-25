"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { actionsFor, type RunAction, type RunContext, type RunStatus } from "@/lib/runStates";
import { useLiveRun } from "./useLiveRun";

// A run that just finished landed on a page showing "website read" with no
// visible drafts. The actual review (qualified/not sure/not qualified, plus
// drafts) lives entirely on the leads page now, so rather than leave the user
// looking at that confusing in-between state, follow the run there
// automatically the moment it finishes with something to show.
//
// Deliberately NOT completed_partial: that status now offers real actions
// right here on this page ("Continue from where it stopped", "Keep
// searching") — added after this redirect was first written. Auto-navigating
// away the instant a manual Stop lands on completed_partial would whisk the
// user past the exact button they clicked Stop to get to, toward a review
// screen they may not have wanted yet. `completed` has no such action (only
// Review/Start new), so redirecting there still avoids a dead-looking screen
// with nothing to do.
const DRAFTS_READY: RunStatus[] = ["completed"];

/**
 * Renders the action buttons for a run.
 *
 * The buttons come from `actionsFor(status)` — the same table the API routes
 * authorise against, keyed on the same status column. There is no separate flag
 * and no local notion of "what stage we're in", so the screen cannot offer
 * something the backend would refuse.
 */

// cursor-pointer is explicit because a native <button> defaults to the arrow
// cursor, not the hand — unlike <a>, browsers do not treat it as a pointer
// target on its own, which is exactly why a button can work correctly and
// still feel inert to click.
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[8px] px-3.5 py-2 text-sm font-medium cursor-pointer " +
  "transition-opacity disabled:cursor-not-allowed disabled:opacity-50";

function classesFor(tone: RunAction["tone"]) {
  if (tone === "primary") {
    return `${BUTTON_BASE} bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90`;
  }
  if (tone === "danger") {
    return `${BUTTON_BASE} border border-[var(--border-strong)] bg-[var(--surface)] hover:bg-[var(--surface-2)]`;
  }
  return `${BUTTON_BASE} border border-[var(--border-strong)] bg-[var(--surface)] hover:bg-[var(--surface-2)]`;
}

export function RunActions({
  runId,
  status,
  ctx,
  changeKey,
  live,
  /**
   * Reasons an action cannot be taken right now, keyed by action id. The button
   * is rendered DISABLED with the reason visible, rather than letting the user
   * click and then fail. Note this only ever blocks — it never hides an action
   * the status table allows.
   */
  blocked = {},
  /** Extra body sent with a given action (e.g. the edited ICP). */
  payloadFor,
}: {
  runId: string;
  status: RunStatus;
  ctx: RunContext;
  changeKey: string;
  live: boolean;
  blocked?: Partial<Record<string, string>>;
  payloadFor?: (actionId: string) => unknown;
}) {
  const router = useRouter();
  const { stalled, staleSeconds, refreshNow, armRefreshWatchdog } = useLiveRun({
    enabled: live,
    changeKey,
  });
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only fires on a live -> finished transition observed while this page is
  // open, never on a fresh page load of a run that was already finished. That
  // keeps "back to run" from the leads page from immediately bouncing the
  // user right back there.
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live && ctx.hasLeads && DRAFTS_READY.includes(status)) {
      router.push(`/runs/${runId}/leads`);
    }
    wasLive.current = live;
  }, [live, status, ctx.hasLeads, router, runId]);

  const actions = actionsFor(status, ctx);

  async function run(action: RunAction) {
    if (action.endpoint === null) {
      if (action.href) {
        router.push(action.href);
        return;
      }
      // "See the leads" navigates to the dedicated leads page (three tabs)
      // rather than scrolling — the full per-lead detail no longer lives on
      // this page at all, so there is nothing left here to scroll to.
      if (action.id === "review") {
        router.push(`/runs/${runId}/leads`);
        return;
      }
      document.getElementById("review")?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    // Disable on submit and show a pending label. Cheap, and it is the one
    // thing users actually see. The real protection is the conditional update
    // in the database, which makes a second request a genuine no-op.
    setPending(action.id);
    setError(null);
    setConfirming(null);

    try {
      const res = await fetch(`/api/runs/${runId}/${action.endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadFor?.(action.id) ?? {}),
      });

      const body: unknown = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message =
          typeof body === "object" && body && "error" in body
            ? String((body as { error: unknown }).error)
            : `That didn't go through (${res.status}).`;
        setError(message);
      } else {
        // Only armed on a real success: nothing changed server-side on a
        // refusal, so there is nothing for a reload to reveal there.
        armRefreshWatchdog();
      }
      refreshNow();
    } catch {
      setError("Couldn't reach the server. Nothing was changed — try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) => {
          const blockedReason = blocked[action.id];
          const isPending = pending === action.id;
          const isConfirming = confirming === action.id;

          if (isConfirming) {
            return (
              <span
                key={action.id}
                className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2"
              >
                <span className="text-sm text-[var(--text-muted)]">{action.confirm}</span>
                <button
                  type="button"
                  className={classesFor("primary")}
                  onClick={() => void run(action)}
                >
                  Yes, {action.label.toLowerCase()}
                </button>
                {/* This button ABANDONS the action. "Keep going" read as if it
                    continued with it — the opposite of what it does. */}
                <button
                  type="button"
                  className={classesFor("quiet")}
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </button>
              </span>
            );
          }

          return (
            <span key={action.id} className="inline-flex flex-col gap-1">
              <button
                type="button"
                className={classesFor(action.tone)}
                disabled={Boolean(blockedReason) || pending !== null}
                aria-describedby={blockedReason ? `${action.id}-why` : undefined}
                onClick={() => {
                  if (action.confirm) setConfirming(action.id);
                  else void run(action);
                }}
              >
                {isPending ? `${action.label}…` : action.label}
              </button>
              {/* The refusal is shown BEFORE the click, not after. */}
              {blockedReason ? (
                <span
                  id={`${action.id}-why`}
                  className="max-w-[22rem] text-xs text-[var(--text-muted)]"
                >
                  {blockedReason}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>

      {error ? (
        <p
          className="rounded-[8px] px-3 py-2 text-sm"
          style={{ color: "var(--error)", background: "var(--error-bg)" }}
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {/* A frozen screen that claims to be live is worse than one that admits
          it is stuck. No manual "Check now" here — this page already polls
          every 3s on its own (useLiveRun), so a manual check can't learn
          anything sooner; it only invited the impression that refreshing was
          necessary. The actual backstop is server-side: sweep_stalled_runs
          (called from this page's own server component AND from the agent's
          own interval) resets a run stuck past 5 minutes with no heartbeat to
          `failed`, at which point this message disappears on its own because
          the run is no longer live. */}
      {stalled ? (
        <p className="text-xs text-[var(--text-muted)]">
          No update for {staleSeconds}s. The run may just be slow, nothing here is lost either way.
          If we still can&apos;t reach the server after 5 minutes total, this run will be reset to its
          last saved state and marked failed, with Retry available to pick back up from there.
        </p>
      ) : null}
    </div>
  );
}
