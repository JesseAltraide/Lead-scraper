"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { intakeFormSchema } from "@/lib/icp";
import { Card, CardHeader, Field, inputClass } from "@/components/ui";

/**
 * Phase 1, Step 1.
 *
 * Every check here is free and instant, and runs BEFORE any Claude call. It
 * would be waste to spend a model call noticing a missing field or min >= max.
 * The message appears next to the field it belongs to, never as a summary at
 * the top that leaves the user hunting.
 */

const EMPTY = {
  industry: "",
  geography: "",
  minEmployees: "10",
  maxEmployees: "100",
  buyerPersona: "",
  businessProblem: "",
  leadsWanted: "10",
  notes: "",
};

export function IntakeForm() {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY);
  const [mustHave, setMustHave] = useState<string[]>([]);
  const [niceToHave, setNiceToHave] = useState<string[]>([]);
  const [skipIf, setSkipIf] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function set(key: keyof typeof EMPTY, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const parsed = intakeFormSchema.safeParse({
      ...values,
      mustHave,
      niceToHave,
      skipIf,
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        fieldErrors[key] ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    // Disabled on submit with a pending label. The real protection against a
    // double-fire is the "one active run per user" index in the database, which
    // makes the second request a genuine no-op whatever the timing.
    setPending(true);

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body: { run_id?: string; error?: string } = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSubmitError(body.error ?? `Couldn't start that (${res.status}).`);
        setPending(false);
        return;
      }
      router.push(`/runs/${body.run_id}`);
    } catch {
      setSubmitError("Couldn't reach the server. Nothing was created — try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Card>
        <CardHeader title="Who are you looking for?" meta="Checked before any AI call" />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <Field
            label="Industry"
            hint="Specific enough to search. “Tech” is too broad."
            error={errors.industry}
          >
            <input
              className={inputClass}
              placeholder="B2B SaaS"
              value={values.industry}
              onChange={(e) => set("industry", e.target.value)}
            />
          </Field>

          <Field label="Geography" error={errors.geography}>
            <input
              className={inputClass}
              placeholder="United States"
              value={values.geography}
              onChange={(e) => set("geography", e.target.value)}
            />
          </Field>

          <Field
            label="Employees"
            error={errors.minEmployees ?? errors.maxEmployees}
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                className={inputClass}
                value={values.minEmployees}
                onChange={(e) => set("minEmployees", e.target.value)}
              />
              <span className="text-sm text-[var(--text-muted)]">to</span>
              <input
                type="number"
                min={1}
                className={inputClass}
                value={values.maxEmployees}
                onChange={(e) => set("maxEmployees", e.target.value)}
              />
            </div>
          </Field>

          <Field label="Leads wanted" hint="1–10." error={errors.leadsWanted}>
            <input
              type="number"
              min={1}
              max={10}
              className={inputClass}
              value={values.leadsWanted}
              onChange={(e) => set("leadsWanted", e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="What you'd say to them" />
        <div className="space-y-4 px-5 py-5">
          <Field
            label="Buyer persona"
            hint="The job title the outreach speaks to. The agent never searches for people — only companies."
            error={errors.buyerPersona}
          >
            <input
              className={inputClass}
              placeholder="Head of Operations"
              value={values.buyerPersona}
              onChange={(e) => set("buyerPersona", e.target.value)}
            />
          </Field>

          <Field
            label="Business problem"
            hint="What you'd solve for them."
            error={errors.businessProblem}
          >
            <textarea
              className={`${inputClass} min-h-20`}
              placeholder="Ops teams losing hours a week to manual data entry between their CRM, billing and support tools."
              value={values.businessProblem}
              onChange={(e) => set("businessProblem", e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Your requirements" meta="You decide which are strict" />
        <div className="space-y-5 px-5 py-5">
          <TagInput
            label="Must have"
            hint="Hard filters beyond industry, geography and size — those three are always strict and have their own fields above. Every must-have needs evidence before a company can qualify."
            items={mustHave}
            onChange={setMustHave}
          />
          <TagInput
            label="Nice to have"
            hint="Raise or lower the confidence score. They never disqualify anyone."
            items={niceToHave}
            onChange={setNiceToHave}
          />
          <TagInput
            label="Skip if"
            hint="Rule a company out only when there's evidence for it. “Can't tell” is never a reason to skip."
            items={skipIf}
            onChange={setSkipIf}
          />
          <Field label="Anything else" hint="Optional.">
            <textarea
              className={`${inputClass} min-h-16`}
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>
      </Card>

      {submitError ? (
        <p
          className="rounded-[8px] px-3 py-2 text-sm"
          style={{ color: "var(--error)", background: "var(--error-bg)" }}
          role="alert"
        >
          {submitError}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[8px] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-text)] disabled:opacity-50"
        >
          {pending ? "Checking your form…" : "Continue"}
        </button>
        <p className="text-xs text-[var(--text-muted)]">
          Nothing is searched or spent yet — you'll confirm the criteria first.
        </p>
      </div>
    </form>
  );
}

function TagInput({
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
  const trimmed = entry.trim();
  const duplicate = items.some((i) => i.toLowerCase() === trimmed.toLowerCase());
  const canAdd = trimmed.length > 0 && !duplicate;

  function add() {
    if (!canAdd) return;
    onChange([...items, trimmed]);
    setEntry("");
  }

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
              {/* Removing is always allowed — only adding a duplicate is blocked. */}
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
            placeholder={`Add to ${label.toLowerCase()}`}
            onChange={(e) => setEntry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          {duplicate ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">Already in this list.</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!canAdd}
          className="rounded-[8px] border border-[var(--border-strong)] px-3 py-2 text-sm disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
