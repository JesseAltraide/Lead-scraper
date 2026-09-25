"use client";

import { useState } from "react";
import type { RunStatus } from "@/lib/runStates";
import type { ClarificationItem } from "@/lib/clarityCheck";
import { RunActions } from "./RunActions";
import { inputClass } from "./ui";

/**
 * The `awaiting_clarification` screen.
 *
 * Two kinds of finding, handled differently on purpose:
 *
 *  - a QUESTION gets a text box. The answer is context, appended to the notes
 *    the agent reads.
 *  - a BLOCKER gets the actual form fields, editable. There is no text box,
 *    because there is nothing to explain: the two answers cannot both be true,
 *    so no explanation makes the search possible. The field has to change.
 *
 * The button is disabled until every blocker's field has genuinely changed —
 * and the server checks the same thing again, so this is a courtesy, not the
 * guard.
 */

const FIELD_LABELS: Record<string, string> = {
  industry: "Industry",
  geography: "Geography",
  minEmployees: "Minimum employees",
  maxEmployees: "Maximum employees",
  buyerPersona: "Buyer persona",
  businessProblem: "Business problem",
  mustHave: "Must have",
  niceToHave: "Nice to have",
  skipIf: "Skip if",
  notes: "Anything else",
};

const NUMERIC = new Set(["minEmployees", "maxEmployees"]);
const LIST = new Set(["mustHave", "niceToHave", "skipIf"]);
const TEXTAREA = new Set(["businessProblem", "notes"]);

function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) =>
    Array.isArray(v)
      ? v.map((x) => String(x).trim().toLowerCase()).sort().join("|")
      : String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

export function ClarifyForm({
  runId,
  status,
  findings,
  form,
  round,
  changeKey,
}: {
  runId: string;
  status: RunStatus;
  findings: ClarificationItem[];
  form: Record<string, unknown>;
  round: number;
  changeKey: string;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, unknown>>({});

  const blockers = findings.filter((f) => f.kind === "blocker");
  const questions = findings.filter((f) => f.kind === "question");

  const current = { ...form, ...edits };

  const unresolved = blockers.filter((b) => b.fields.every((f) => sameValue(form[f], current[f])));
  const unanswered = questions.filter((q) => !(answers[q.fields[0]!] ?? "").trim());

  const blocked = {
    answer_clarification: unresolved.length
      ? `Change ${unresolved.length === 1 ? "one of the highlighted answers" : "the highlighted answers"} — these can't both be true, so there's nothing to explain.`
      : unanswered.length
        ? `${unanswered.length} question${unanswered.length === 1 ? "" : "s"} still to answer.`
        : undefined,
  };

  function setField(field: string, value: unknown) {
    setEdits((e) => ({ ...e, [field]: value }));
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-[var(--text-muted)]">
        Round {round} of 3. Nothing has been searched or spent yet.
      </p>

      {blockers.map((b, i) => (
        <div
          key={`b-${i}`}
          className="rounded-[var(--radius)] border px-4 py-4"
          style={{ borderColor: "var(--error)", background: "var(--error-bg)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--error)" }}>
            These answers contradict each other
          </p>
          <p className="mt-1.5 text-sm">{b.question}</p>
          {b.why ? <p className="mt-1 text-sm text-[var(--text-muted)]">{b.why}</p> : null}

          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Change whichever one you meant differently. No company could match both as written, so
            the search can&apos;t run until one changes.
          </p>

          <div className="mt-3 space-y-3">
            {b.fields.map((field) => (
              <FieldEditor
                key={field}
                field={field}
                value={current[field]}
                changed={!sameValue(form[field], current[field])}
                original={form[field]}
                onChange={(v) => setField(field, v)}
              />
            ))}
          </div>
        </div>
      ))}

      {questions.map((q, i) => {
        const field = q.fields[0]!;
        return (
          <div key={`q-${i}`}>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-faint)]">
              {FIELD_LABELS[field] ?? field}
            </p>
            <label className="mb-1.5 block text-sm font-medium">{q.question}</label>
            {q.why ? <p className="mb-1.5 text-xs text-[var(--text-muted)]">{q.why}</p> : null}
            <textarea
              className={`${inputClass} min-h-16`}
              value={answers[field] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [field]: e.target.value }))}
            />
          </div>
        );
      })}

      <div className="border-t border-[var(--border)] pt-4">
        <RunActions
          runId={runId}
          status={status}
          ctx={{ hasIcp: false, hasLeads: false, continuesUsed: 0 }}
          changeKey={changeKey}
          live={false}
          blocked={blocked}
          payloadFor={() => ({ answers, formEdits: edits })}
        />
      </div>
    </div>
  );
}

function FieldEditor({
  field,
  value,
  original,
  changed,
  onChange,
}: {
  field: string;
  value: unknown;
  original: unknown;
  changed: boolean;
  onChange: (v: unknown) => void;
}) {
  const label = FIELD_LABELS[field] ?? field;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        {changed ? (
          <span className="text-xs" style={{ color: "var(--done)" }}>
            changed
          </span>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">
            was “{Array.isArray(original) ? original.join(", ") : String(original ?? "")}”
          </span>
        )}
      </div>

      {NUMERIC.has(field) ? (
        <input
          type="number"
          min={1}
          className={inputClass}
          value={String(value ?? "")}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      ) : LIST.has(field) ? (
        <input
          className={inputClass}
          placeholder="Separate items with commas"
          value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            )
          }
        />
      ) : TEXTAREA.has(field) ? (
        <textarea
          className={`${inputClass} min-h-20`}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={inputClass}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
