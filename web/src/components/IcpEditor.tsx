"use client";

import { useState } from "react";
import type { Icp } from "@/lib/icp";
import type { RunStatus } from "@/lib/runStates";
import { RunActions } from "./RunActions";
import { Field, inputClass } from "./ui";

/**
 * The confirm-and-edit screen at `icp_ready`.
 *
 * This is the user's last chance to correct the agent before any money is
 * spent, so every field is editable — including moving a requirement between
 * hard and soft. A system that decides the audience and won't let the user
 * override it is the exact failure this step exists to prevent.
 */
export function IcpEditor({
  runId,
  status,
  icp,
  changeKey,
}: {
  runId: string;
  status: RunStatus;
  icp: Icp;
  changeKey: string;
}) {
  const [draft, setDraft] = useState<Icp>(icp);
  const [dirty, setDirty] = useState(false);

  function update<K extends keyof Icp>(key: K, value: Icp[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }

  const sizeInvalid = draft.minEmployees >= draft.maxEmployees;
  const emptyHardFilter = draft.hardFilters.some((f) => !f.text.trim());

  /**
   * Reasons an action can't be taken, shown on the disabled button rather than
   * discovered after clicking. These only ever block — they never remove an
   * action the status table allows, and they never trap an existing value:
   * a hard filter can always be removed, only adding a blank one is stopped.
   */
  const blocked: Record<string, string | undefined> = {
    start_research: sizeInvalid
      ? "Minimum employees must be below the maximum."
      : emptyHardFilter
        ? "One of the hard filters is empty — fill it in or remove it."
        : dirty
          ? "You have unsaved edits. Save them first so research uses the version you're looking at."
          : undefined,
    edit_icp: sizeInvalid || emptyHardFilter ? "Fix the highlighted fields first." : undefined,
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Industry">
          <input
            className={inputClass}
            value={draft.industry}
            onChange={(e) => update("industry", e.target.value)}
          />
        </Field>
        <Field label="Geography">
          <input
            className={inputClass}
            value={draft.geography}
            onChange={(e) => update("geography", e.target.value)}
          />
        </Field>
        <Field
          label="Employees"
          error={sizeInvalid ? "Minimum must be below the maximum." : undefined}
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              className={inputClass}
              value={draft.minEmployees}
              onChange={(e) => update("minEmployees", Number(e.target.value))}
            />
            <span className="text-sm text-[var(--text-muted)]">to</span>
            <input
              type="number"
              min={1}
              className={inputClass}
              value={draft.maxEmployees}
              onChange={(e) => update("maxEmployees", Number(e.target.value))}
            />
          </div>
        </Field>
        <Field
          label="Buyer persona"
          hint="Who the outreach is written for. Never someone the agent searches for."
        >
          <input
            className={inputClass}
            value={draft.buyerPersona}
            onChange={(e) => update("buyerPersona", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Business problem">
        <textarea
          className={`${inputClass} min-h-20`}
          value={draft.businessProblem}
          onChange={(e) => update("businessProblem", e.target.value)}
        />
      </Field>

      <div>
        <p className="mb-1.5 text-sm font-medium">Hard filters</p>
        <p className="mb-2.5 text-xs text-[var(--text-muted)]">
          Every one of these must be confirmed by evidence for a company to qualify. Industry,
          geography and size are always hard filters — they have their own fields above.
        </p>
        <div className="space-y-2">
          {draft.hardFilters.map((f, i) => {
            const fixed = ["industry", "geography", "company_size"].includes(f.key);
            return (
              <div key={f.key} className="flex items-center gap-2">
                <input
                  className={inputClass}
                  value={f.text}
                  readOnly={fixed}
                  aria-label={`Hard filter ${i + 1}`}
                  onChange={(e) => {
                    const next = [...draft.hardFilters];
                    next[i] = { ...f, text: e.target.value };
                    update("hardFilters", next);
                  }}
                  style={fixed ? { background: "var(--surface-2)" } : undefined}
                />
                {fixed ? (
                  <span className="w-24 shrink-0 text-xs text-[var(--text-faint)]">
                    from its field
                  </span>
                ) : (
                  /* Removing is always allowed, even when the value is invalid —
                     a guard must never trap an existing entry. */
                  <button
                    type="button"
                    className="w-24 shrink-0 text-xs text-[var(--text-muted)] underline underline-offset-2"
                    onClick={() =>
                      update(
                        "hardFilters",
                        draft.hardFilters.filter((_, j) => j !== i),
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ListEditor
        label="Nice to have"
        hint="These change the confidence score. They never disqualify a company."
        items={draft.niceToHave}
        onChange={(v) => update("niceToHave", v)}
      />

      <ListEditor
        label="Skip if"
        hint="These rule a company out only when there is positive evidence. “Can't tell” is never a reason."
        items={draft.skipIf}
        onChange={(v) => update("skipIf", v)}
      />

      <div className="border-t border-[var(--border)] pt-4">
        <RunActions
          runId={runId}
          status={status}
          changeKey={changeKey}
          live={false}
          blocked={blocked}
          payloadFor={() => ({ icp: draft })}
        />
      </div>
    </div>
  );
}

function ListEditor({
  label,
  hint,
  items,
  onChange,
}: {
  label: string;
  hint: string;
  items: string[];
  onChange: (next: string[]) => void;
}) {
  const [entry, setEntry] = useState("");
  const duplicate = items.some((i) => i.toLowerCase() === entry.trim().toLowerCase());
  const canAdd = entry.trim().length > 0 && !duplicate;

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <p className="mb-2.5 text-xs text-[var(--text-muted)]">{hint}</p>

      {items.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <li
              key={`${item}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs"
            >
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                className="text-[var(--text-muted)]"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-start gap-2">
        <div className="flex-1">
          <input
            className={inputClass}
            value={entry}
            placeholder={`Add a ${label.toLowerCase()} item`}
            onChange={(e) => setEntry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canAdd) {
                e.preventDefault();
                onChange([...items, entry.trim()]);
                setEntry("");
              }
            }}
          />
          {duplicate ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">Already in this list.</p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={!canAdd}
          className="rounded-[8px] border border-[var(--border-strong)] px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => {
            onChange([...items, entry.trim()]);
            setEntry("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
