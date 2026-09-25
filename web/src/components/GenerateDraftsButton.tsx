"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Manually triggers drafting for a lead's still-missing pieces (see
 * app/api/runs/[id]/leads/[leadId]/drafts/generate/route.ts for what "still
 * missing" means and why this exists for needs_review leads and for a
 * qualified lead short on drafts from a budget-exhausted run).
 */
export function GenerateDraftsButton({ runId, leadId }: { runId: string; leadId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/leads/${leadId}/drafts/generate`, {
        method: "POST",
      });
      const body: { error?: string; failed?: { piece: string; reason: string }[] } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `That didn't go through (${res.status}).`);
      } else if (body.failed && body.failed.length > 0) {
        setError(
          `${body.failed.length} piece(s) couldn't be written: ${body.failed
            .map((f) => `${f.piece} (${f.reason})`)
            .join("; ")}`,
        );
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Nothing was changed, try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="px-5 py-3">
      <button
        type="button"
        className="cursor-pointer rounded-full border border-[var(--border-strong)] px-3 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending}
        onClick={() => void run()}
      >
        {pending ? "Writing…" : "Write outreach drafts"}
      </button>
      {error ? (
        <p className="mt-1.5 max-w-prose text-xs" style={{ color: "var(--error)" }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
