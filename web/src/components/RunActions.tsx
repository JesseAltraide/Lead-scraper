"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { actionsFor, type RunAction, type RunContext, type RunStatus } from "@/lib/runStates";
import { useLiveRun } from "./useLiveRun";

/**
 * Renders the action buttons for a run.
 *
 * The buttons come from `actionsFor(status)` — the same table the API routes
 * authorise against, keyed on the same status column. There is no separate flag
 * and no local notion of "what stage we're in", so the screen cannot offer
 * something the backend would refuse.
 */

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[8px] px-3.5 py-2 text-sm font-medium " +
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
  const { stalled, staleSeconds, refreshNow } = useLiveRun({ enabled: live, changeKey });
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = actionsFor(status, ctx);

  async function run(action: RunAction) {
    if (action.endpoint === null) {
      if (action.href) {
        router.push(action.href);
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
                <button
                  type="button"
                  className={classesFor("quiet")}
                  onClick={() => setConfirming(null)}
                >
                  Keep going
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
          it is stuck. */}
      {stalled ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>
            No update for {staleSeconds}s. The run may just be slow — nothing here is lost either
            way.
          </span>
          <button type="button" className="underline underline-offset-2" onClick={refreshNow}>
            Check now
          </button>
        </p>
      ) : null}
    </div>
  );
}
