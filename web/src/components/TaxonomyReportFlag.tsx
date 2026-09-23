"use client";

import { useState } from "react";

/**
 * "None of these — let us know" — appears only under a taxonomy rejection
 * that already offered real suggestions. Deliberately absent for plain
 * gibberish (empty `suggestions`): reporting on "asdfgh" gives a maintainer
 * nothing to act on, so the caller simply never renders this when
 * `suggestions.length === 0`.
 *
 * Sends a REPORT, not a live change — see api/taxonomy-reports/route.ts. The
 * search behaves identically for every other user the moment after this is
 * sent; it only ever informs a later, reviewed edit to the taxonomy file.
 */
export function TaxonomyReportFlag({
  field,
  rawInput,
  suggestions,
}: {
  field: "industry" | "geography";
  rawInput: string;
  suggestions: string[];
}) {
  const [open, setOpen] = useState(false);
  // undefined = nothing picked yet (Send stays disabled); null = the user
  // explicitly said "none of these"; a string = which suggestion was right.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  // Only meaningful when chosen === null — what "none of these" actually
  // meant, since a bare rejection gives a reviewer nothing to add.
  const [describedAs, setDescribedAs] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (suggestions.length === 0) return null;

  if (status === "sent") {
    return (
      <p className="mt-1.5 text-xs text-[var(--text-muted)]">
        Thanks — sent for review. This doesn&apos;t change your search now.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="mt-1.5 text-xs text-[var(--text-muted)] underline underline-offset-2"
        onClick={() => setOpen(true)}
      >
        None of these? Let us know what you meant
      </button>
    );
  }

  async function send() {
    setStatus("sending");
    try {
      const res = await fetch("/api/taxonomy-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          field,
          rawInput,
          suggestionsShown: suggestions,
          chosenLabel: chosen ?? null,
          userDescribedAs: chosen === null ? describedAs.trim() || null : null,
        }),
      });
      if (!res.ok) throw new Error("request failed");
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mt-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface-2)] p-3 text-xs">
      <p className="mb-2 text-[var(--text-muted)]">
        Which was closest to what you meant? This is sent for review — it won&apos;t change what you
        can search right now.
      </p>

      <div className="mb-2 space-y-1">
        {suggestions.map((s) => (
          <label key={s} className="flex items-center gap-2">
            <input
              type="radio"
              name={`taxonomy-choice-${field}`}
              checked={chosen === s}
              onChange={() => setChosen(s)}
            />
            {s}
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`taxonomy-choice-${field}`}
            checked={chosen === null}
            onChange={() => setChosen(null)}
          />
          None of these
        </label>
      </div>

      {chosen === null ? (
        <div className="mb-2 pl-6">
          {/* A placeholder alone isn't a label — it disappears once typing
              starts and isn't reliably announced by screen readers. */}
          <label htmlFor={`taxonomy-described-as-${field}`} className="sr-only">
            What did you mean by &quot;{rawInput}&quot;?
          </label>
          <input
            id={`taxonomy-described-as-${field}`}
            type="text"
            className="w-full rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-xs"
            placeholder={`What did you mean by "${rawInput}"?`}
            value={describedAs}
            onChange={(e) => setDescribedAs(e.target.value)}
            maxLength={200}
            autoFocus
          />
        </div>
      ) : null}

      {status === "error" ? (
        <p className="mb-2" style={{ color: "var(--error)" }} role="alert">
          Couldn&apos;t send that — try again.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={chosen === undefined || status === "sending"}
          className="rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1 disabled:opacity-50"
          onClick={() => void send()}
        >
          {status === "sending" ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          className="text-[var(--text-muted)] underline underline-offset-2"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
