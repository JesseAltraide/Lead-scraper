"use client";

import { useState } from "react";
import type { RunStatus } from "@/lib/runStates";
import { RunActions } from "./RunActions";
import { inputClass } from "./ui";

export type ClarificationQuestion = {
  field: string;
  question: string;
  why?: string;
};

/**
 * The `awaiting_clarification` screen. Each question names the one field it is
 * about, so the user never has to work out what is being asked of them.
 */
export function ClarifyForm({
  runId,
  status,
  questions,
  round,
  changeKey,
}: {
  runId: string;
  status: RunStatus;
  questions: ClarificationQuestion[];
  round: number;
  changeKey: string;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const unanswered = questions.filter((q) => !(answers[q.field] ?? "").trim());

  const blocked = {
    answer_clarification: unanswered.length
      ? `${unanswered.length} question${unanswered.length === 1 ? "" : "s"} still to answer.`
      : undefined,
  };

  return (
    <div className="space-y-5">
      <p className="text-xs text-[var(--text-muted)]">
        Round {round} of 3. Nothing has been searched or spent yet.
      </p>

      {questions.map((q) => (
        <div key={q.field}>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-faint)]">
            {q.field}
          </p>
          <label className="mb-1.5 block text-sm font-medium">{q.question}</label>
          {q.why ? <p className="mb-1.5 text-xs text-[var(--text-muted)]">{q.why}</p> : null}
          <textarea
            className={`${inputClass} min-h-16`}
            value={answers[q.field] ?? ""}
            onChange={(e) => setAnswers((a) => ({ ...a, [q.field]: e.target.value }))}
          />
        </div>
      ))}

      <div className="border-t border-[var(--border)] pt-4">
        <RunActions
          runId={runId}
          status={status}
          changeKey={changeKey}
          live={false}
          blocked={blocked}
          payloadFor={() => ({ answers })}
        />
      </div>
    </div>
  );
}
