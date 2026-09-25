"use client";

import { useRef, useState, forwardRef, useImperativeHandle } from "react";
import { useRouter } from "next/navigation";
import { intakeFormSchema, COMPANY_SIZE_BANDS } from "@/lib/icp";
import { KNOWN_PLACES } from "@/lib/geography";
import { suggestIndustries } from "@/lib/industries";
import { isGibberish } from "@/lib/gibberish";
import { Card, CardHeader, Field, inputClass } from "@/components/ui";
import { TaxonomyReportFlag } from "@/components/TaxonomyReportFlag";

/**
 * Phase 1, Step 1.
 *
 * Every check here is free and instant, and runs BEFORE any Claude call. It
 * would be waste to spend a model call noticing a missing field or min >= max.
 * The message appears next to the field it belongs to, never as a summary at
 * the top that leaves the user hunting.
 */

const DEFAULT_SIZE_BAND = "11-50";

/**
 * Visual top-to-bottom order of the fields that can carry a validation
 * error — used to find the FIRST one actually on screen, not just the first
 * one zod happened to report. zod's issue order roughly follows schema
 * declaration order, which isn't guaranteed to match layout order (e.g. an
 * object-level min<max refine can surface after later per-field issues).
 */
const FIELD_ORDER = [
  "industry",
  "geography",
  "minEmployees",
  "maxEmployees",
  "leadsWanted",
  "buyerPersona",
  "businessProblem",
  "notes",
  // mustHave/niceToHave/skipIf are deliberately absent: submit() commits any
  // pending typed-but-not-added text in those fields first (see
  // TagInput.commitPending below), so by the time zod runs, each list is
  // either the user's real intent or submit already stopped on a duplicate/
  // gibberish pending entry with its own inline message. Nothing left here
  // for zod to reject that would need a scroll target.
] as const;

const EMPTY = {
  industry: "",
  geography: "",
  companySizeBand: DEFAULT_SIZE_BAND,
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
  const mustHaveRef = useRef<TagInputHandle>(null);
  const niceToHaveRef = useRef<TagInputHandle>(null);
  const skipIfRef = useRef<TagInputHandle>(null);
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

    // Text typed into a Must have/Nice to have/Skip if box but never
    // committed with "Add" or Enter must never be silently dropped here —
    // that is exactly how a real hard filter the user typed can vanish with
    // no chip, no error, and nothing for the clarity check to ever see. Each
    // ref commits its own pending text (or returns null if it can't, because
    // it's a duplicate or gibberish, in which case that field's own inline
    // message is already visible and submit stops rather than losing it).
    const committedMustHave = mustHaveRef.current?.commitPending();
    const committedNiceToHave = niceToHaveRef.current?.commitPending();
    const committedSkipIf = skipIfRef.current?.commitPending();
    if (!committedMustHave || !committedNiceToHave || !committedSkipIf) return;

    const band = COMPANY_SIZE_BANDS.find((b) => b.label === values.companySizeBand);
    const parsed = intakeFormSchema.safeParse({
      ...values,
      minEmployees: band?.min,
      maxEmployees: band?.max,
      mustHave: committedMustHave,
      niceToHave: committedNiceToHave,
      skipIf: committedSkipIf,
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        fieldErrors[key] ??= issue.message;
      }
      setErrors(fieldErrors);

      // Scroll to whichever error is actually topmost on the page — a field
      // several screens down otherwise fails silently as far as the user can
      // tell, since nothing above the fold changed.
      const firstBadField = FIELD_ORDER.find((key) => fieldErrors[key]);
      if (firstBadField) {
        // minEmployees and maxEmployees share one visual control (the size
        // band dropdown); either error name resolves to the same element.
        const elementId =
          firstBadField === "maxEmployees" ? "field-minEmployees" : `field-${firstBadField}`;
        const el = document.getElementById(elementId);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.focus();
      }
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
            hint="Specific enough to search. “Business” is too broad."
            error={errors.industry}
          >
            <input
              id="field-industry"
              className={inputClass}
              placeholder="B2B SaaS"
              value={values.industry}
              onChange={(e) => set("industry", e.target.value)}
            />
            {errors.industry ? (
              <TaxonomyReportFlag
                field="industry"
                rawInput={values.industry}
                suggestions={suggestIndustries(values.industry)}
              />
            ) : null}
          </Field>

          <Field
            label="Geography"
            hint="A country or region. For a state or city, use Must have instead."
            error={errors.geography}
          >
            <input
              id="field-geography"
              className={inputClass}
              placeholder="United States"
              list="known-places"
              autoComplete="off"
              value={values.geography}
              onChange={(e) => set("geography", e.target.value)}
            />
            {/* Showing the valid answers beats making the user guess at them. */}
            <datalist id="known-places">
              {KNOWN_PLACES.map((place) => (
                <option key={place} value={place} />
              ))}
            </datalist>
          </Field>

          <Field
            label="Employees"
            hint="The search provider only filters by these exact bands."
            error={errors.minEmployees ?? errors.maxEmployees}
          >
            <select
              id="field-minEmployees"
              className={inputClass}
              value={values.companySizeBand}
              onChange={(e) => set("companySizeBand", e.target.value)}
            >
              {COMPANY_SIZE_BANDS.map((band) => (
                <option key={band.label} value={band.label}>
                  {band.label} employees
                </option>
              ))}
            </select>
          </Field>

          <Field label="Leads wanted" hint="1–10." error={errors.leadsWanted}>
            <input
              id="field-leadsWanted"
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
              id="field-buyerPersona"
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
              id="field-businessProblem"
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
            ref={mustHaveRef}
            label="Must have"
            hint="Hard filters beyond industry, geography and size — those three are always strict and have their own fields above. Every must-have needs evidence before a company can qualify."
            items={mustHave}
            onChange={setMustHave}
          />
          <TagInput
            ref={niceToHaveRef}
            label="Nice to have"
            hint="Raise or lower the confidence score. They never disqualify anyone."
            items={niceToHave}
            onChange={setNiceToHave}
          />
          <TagInput
            ref={skipIfRef}
            label="Skip if"
            hint="Rule a company out only when there's evidence for it. “Can't tell” is never a reason to skip."
            items={skipIf}
            onChange={setSkipIf}
          />
          <Field label="Anything else" hint="Optional." error={errors.notes}>
            <textarea
              id="field-notes"
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
          Nothing is searched or spent yet — you&apos;ll confirm the criteria first.
        </p>
      </div>
    </form>
  );
}

type TagInputHandle = {
  /**
   * Commits any text still sitting in the box (not yet added) into the list
   * and returns the resulting array. Returns null if that text is a
   * duplicate or gibberish, rather than the list unchanged, so the caller
   * knows to stop instead of silently proceeding as if nothing was typed.
   */
  commitPending: () => string[] | null;
};

const TagInput = forwardRef<
  TagInputHandle,
  {
    label: string;
    hint: string;
    items: string[];
    onChange: (next: string[]) => void;
  }
>(function TagInput({ label, hint, items, onChange }, ref) {
  const [entry, setEntry] = useState("");
  const trimmed = entry.trim();
  const duplicate = items.some((i) => i.toLowerCase() === trimmed.toLowerCase());
  const gibberish = trimmed.length > 0 && isGibberish(trimmed);
  const canAdd = trimmed.length > 0 && !duplicate && !gibberish;

  function add() {
    if (!canAdd) return;
    onChange([...items, trimmed]);
    setEntry("");
  }

  useImperativeHandle(ref, () => ({
    commitPending() {
      if (trimmed.length === 0) return items;
      if (!canAdd) return null;
      const next = [...items, trimmed];
      onChange(next);
      setEntry("");
      return next;
    },
  }));

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
          ) : gibberish ? (
            <p className="mt-1 text-xs" style={{ color: "var(--error)" }} role="alert">
              That doesn&apos;t look like real text — check for typos or stray characters.
            </p>
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
});
