"use client";

import { useState } from "react";

/**
 * The Export link, with an inline confirm step first — matching the same
 * click-to-arm, click-again pattern RunActions.tsx already uses for its own
 * confirmable actions, rather than a native window.confirm() or a separate
 * modal system this app doesn't otherwise have.
 *
 * Still a real file download once confirmed: the confirmed state renders a
 * plain <a href> to the export route, not a fetch — the browser handles the
 * download exactly as it would from a direct link.
 */
export function ExportButton({ runId }: { runId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2">
        <span className="text-sm text-[var(--text-muted)]">
          Only leads with reviewed drafts will be exported. Continue?
        </span>
        <a
          href={`/api/runs/${runId}/export`}
          className="cursor-pointer rounded-[8px] bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-[var(--accent-text)] hover:opacity-90"
          onClick={() => setConfirming(false)}
        >
          Yes, export
        </a>
        <button
          type="button"
          className="cursor-pointer rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--surface-2)]"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="cursor-pointer rounded-full border border-[var(--border-strong)] px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
      onClick={() => setConfirming(true)}
    >
      Export as Word (.docx)
    </button>
  );
}
