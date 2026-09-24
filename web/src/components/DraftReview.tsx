"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, inputClass } from "@/components/ui";
import {
  PIECE_KEYS,
  PIECE_LABELS,
  versionIndex,
  type DraftPiece,
  type DraftVersion,
} from "@/lib/drafts";
import {
  MAX_REWRITES,
  CANCELLABLE_AFTER_MS,
  draftActionAvailability,
  rewritePhase,
} from "@/lib/draftStates";

/**
 * Phase 5 / full-flow.md "Editing and rewriting drafts", for one qualified
 * lead's four outreach pieces. There is deliberately no "send" anywhere here
 * — copying a chosen version out to an email client is the manual step this
 * screen stops short of.
 */
export function DraftReview({
  runId,
  leadId,
  pieces,
  versionsByPiece,
}: {
  runId: string;
  leadId: string;
  pieces: DraftPiece[];
  versionsByPiece: Record<string, DraftVersion[]>;
}) {
  if (pieces.length === 0) {
    return (
      <p className="px-5 py-4 text-xs text-[var(--text-muted)]">
        No outreach drafts yet for this lead.
      </p>
    );
  }

  return (
    <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
      {PIECE_KEYS.map((key) => {
        const piece = pieces.find((p) => p.piece_key === key);
        if (!piece) return null;
        const versions = versionsByPiece[piece.id] ?? [];
        const chosen = versions.find((v) => v.is_chosen);
        if (!chosen) return null;
        return (
          <PieceReview
            key={piece.id}
            runId={runId}
            leadId={leadId}
            piece={piece}
            versions={versions}
            chosen={chosen}
          />
        );
      })}
    </div>
  );
}

function PieceReview({
  runId,
  leadId,
  piece,
  versions,
  chosen,
}: {
  runId: string;
  leadId: string;
  piece: DraftPiece;
  versions: DraftVersion[];
  chosen: DraftVersion;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "rewrite">("view");
  const [subject, setSubject] = useState(chosen.subject ?? "");
  const [body, setBody] = useState(chosen.body);
  const [note, setNote] = useState(chosen.personalization_note);
  const [rewriteNote, setRewriteNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The clock, read only after mount — never during render, which would be
   * impure and would let the server's HTML disagree with hydration across the
   * two-minute boundary. Until this is set, draftStates treats the phase as
   * "running", which is the safe answer: nothing is offered that the backend
   * might refuse.
   */
  const [now, setNow] = useState<number | null>(null);

  // A rewrite whose process died leaves the slot in flight, and this screen
  // does not poll once a run has finished — so without this the "Cancel the
  // stuck rewrite" button would never appear on its own and the user would sit
  // at "still running", needing a manual reload to escape.
  useEffect(() => {
    const readClock = () => setNow(Date.now());

    // Deferred rather than called straight from the effect body: the value is
    // a post-mount wall-clock reading, and setting state synchronously here
    // would force an immediate second render for no benefit.
    const onMount = setTimeout(readClock, 0);

    // Read it again at the moment this piece becomes cancellable, so the
    // Cancel button appears on its own instead of waiting for a manual reload.
    let whenCancellable: ReturnType<typeof setTimeout> | undefined;
    if (piece.rewrite_in_flight && piece.rewrite_claimed_at) {
      const claimedAt = Date.parse(piece.rewrite_claimed_at);
      if (!Number.isNaN(claimedAt)) {
        const ms = claimedAt + CANCELLABLE_AFTER_MS - Date.now();
        if (ms > 0) whenCancellable = setTimeout(readClock, ms + 1_000);
      }
    }

    return () => {
      clearTimeout(onMount);
      if (whenCancellable) clearTimeout(whenCancellable);
    };
  }, [piece.rewrite_in_flight, piece.rewrite_claimed_at]);

  const base = `/api/runs/${runId}/leads/${leadId}/drafts/${piece.piece_key}`;
  const { index, total } = versionIndex(versions, chosen.id);

  // Availability comes from draftStates.ts — the SAME function the API routes
  // use, so this screen can never offer something the backend would refuse,
  // nor hide something it would accept.
  const pieceState = {
    rewritesRequested: piece.rewrites_requested,
    rewriteInFlight: piece.rewrite_in_flight,
    rewriteClaimedAt: piece.rewrite_claimed_at,
  };
  const canRewrite = draftActionAvailability("rewrite", pieceState, now);
  const canCancelRewrite = draftActionAvailability("cancel_rewrite", pieceState, now);
  const phase = rewritePhase(pieceState, now);
  const originLabel =
    chosen.origin === "initial"
      ? "written by the agent"
      : chosen.origin === "edit"
        ? "edited"
        : `rewritten: "${chosen.rewrite_note}"`;

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");
      setMode("view");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{PIECE_LABELS[piece.piece_key]}</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">
            Version {index} of {total} — {originLabel}
          </span>
          <Badge tone={chosen.reviewed ? "done" : "waiting"}>
            {chosen.reviewed ? "Reviewed" : "Not reviewed"}
          </Badge>
        </div>
      </div>

      {total > 1 ? (
        <select
          className={`${inputClass} mt-2 max-w-xs`}
          value={chosen.id}
          disabled={busy}
          onChange={(e) => post(`${base}/versions/${e.target.value}/choose`, {})}
        >
          {[...versions]
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((v, i) => (
              <option key={v.id} value={v.id}>
                Version {i + 1} — {v.origin}
                {v.id === chosen.id ? " (current)" : ""}
              </option>
            ))}
        </select>
      ) : null}

      {mode === "view" ? (
        <div className="mt-3 space-y-2">
          {chosen.subject ? <p className="text-sm font-medium">{chosen.subject}</p> : null}
          <p className="whitespace-pre-wrap text-sm">{chosen.body}</p>
          <p className="text-xs text-[var(--text-muted)]">
            Personalization: {chosen.personalization_note}
            {chosen.citation_source_url ? ` — ${chosen.citation_source_url}` : ""}
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            {/* Native <button> defaults to the arrow cursor, not the hand —
                unlike <a>, browsers do not treat it as a pointer target on its
                own. Every button here needs cursor-pointer AND a hover state
                explicitly, or it reads as inert even though it works. */}
            <button
              type="button"
              className="cursor-pointer rounded-full border border-[var(--border-strong)] px-3 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
              onClick={() => {
                setSubject(chosen.subject ?? "");
                setBody(chosen.body);
                setNote(chosen.personalization_note);
                setMode("edit");
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-full border border-[var(--border-strong)] px-3 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              disabled={!canRewrite.available}
              onClick={() => setMode("rewrite")}
            >
              Rewrite with a note ({piece.rewrites_requested}/{MAX_REWRITES} used)
            </button>

            {/* The escape hatch: a rewrite that never finished used to leave
                this piece permanently unrewritable behind a disabled button.
                Cancelling releases the slot AND refunds it. */}
            {canCancelRewrite.available ? (
              <button
                type="button"
                className="cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: "var(--error)", color: "var(--error)" }}
                disabled={busy}
                onClick={() => post(`${base}/cancel-rewrite`, {})}
              >
                Cancel the stuck rewrite
              </button>
            ) : null}
            {!chosen.reviewed ? (
              <button
                type="button"
                className="cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: "var(--done-bg)", color: "var(--done)" }}
                disabled={busy}
                onClick={() => post(`${base}/versions/${chosen.id}/review`, {})}
              >
                Mark reviewed
              </button>
            ) : null}
          </div>
        </div>
      ) : mode === "edit" ? (
        <div className="mt-3 space-y-2">
          {piece.piece_key.startsWith("email") ? (
            <input
              className={inputClass}
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          ) : null}
          <textarea
            className={`${inputClass} min-h-24`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <textarea
            className={`${inputClass} min-h-12`}
            placeholder="Personalization note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-full px-3 py-1 text-xs font-medium text-white"
              style={{ background: "var(--accent)" }}
              disabled={busy}
              onClick={() => post(`${base}/edit`, { subject, body, personalization_note: note })}
            >
              Save edit
            </button>
            <button
              type="button"
              className="rounded-full border border-[var(--border-strong)] px-3 py-1 text-xs font-medium"
              onClick={() => setMode("view")}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            className={`${inputClass} min-h-16`}
            placeholder='What to change, e.g. "shorter, less salesy"'
            value={rewriteNote}
            onChange={(e) => setRewriteNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-full px-3 py-1 text-xs font-medium text-white"
              style={{ background: "var(--accent)" }}
              disabled={busy || !rewriteNote.trim()}
              onClick={() => post(`${base}/rewrite`, { note: rewriteNote })}
            >
              {busy ? "Rewriting…" : "Rewrite"}
            </button>
            <button
              type="button"
              className="rounded-full border border-[var(--border-strong)] px-3 py-1 text-xs font-medium"
              onClick={() => setMode("view")}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* A disabled button with no explanation is the thing that strands
          people. If a rewrite isn't possible right now, say why AND what to do
          instead — and say it before the click, not after a failed one. */}
      {mode === "view" && !canRewrite.available && canRewrite.reason ? (
        <p
          className="mt-2 max-w-prose text-xs"
          style={{ color: phase === "abandoned" ? "var(--error)" : "var(--text-muted)" }}
        >
          {canRewrite.reason}
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs" style={{ color: "var(--error)" }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
