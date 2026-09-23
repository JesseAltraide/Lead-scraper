"use client";

import { useState } from "react";
import { COMPANY_SIZE_BANDS, companySizeBandFor, type Icp } from "@/lib/icp";
import type { RunStatus } from "@/lib/runStates";
import { RunActions } from "./RunActions";
import { Field, inputClass } from "./ui";
import { KNOWN_PLACES, isKnownPlace } from "@/lib/geography";
import { canonicalIndustry } from "@/lib/industries";

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
  const sizeBand = companySizeBandFor(draft.minEmployees, draft.maxEmployees);

  function setSizeBand(label: string) {
    const band = COMPANY_SIZE_BANDS.find((b) => b.label === label);
    if (!band) return;
    // Both bounds always come from the same band, so this can never land on
    // an invalid min >= max pair the way free-typed min/max fields could.
    setDraft((d) => ({ ...d, minEmployees: band.min, maxEmployees: band.max }));
    setDirty(true);
  }
  const emptyHardFilter = draft.hardFilters.some((f) => !f.text.trim());
  const geographyInvalid = !isKnownPlace(draft.geography);
  // Same shape as geography: the search actor filters by a numeric industry
  // id, so a retyped industry has to still resolve to one before this ICP
  // can be saved (Decision #55).
  const industryInvalid = canonicalIndustry(draft.industry) === null;

  /**
   * Reasons an action can't be taken, shown on the disabled button rather than
   * discovered after clicking. These only ever block — they never remove an
   * action the status table allows, and they never trap an existing value:
   * a hard filter can always be removed, only adding a blank one is stopped.
   */
  // A range can be a perfectly valid min < max pair and still not be one of
  // the actor's fixed bands (e.g. a legacy or directly-API-written ICP) — the
  // server already refuses that (icpSchema), but refusing it only after a
  // click would violate this codebase's own UI-honesty rule ("show the
  // refusal before the click, not after"), so it has to block here too.
  const sizeOffBand = !sizeInvalid && sizeBand === null;

  const blocked: Record<string, string | undefined> = {
    start_research: geographyInvalid
      ? "Geography isn't a place we can search — pick a country or region."
      : industryInvalid
        ? "That industry isn't one the search recognises."
      : sizeInvalid
        ? "Minimum employees must be below the maximum."
      : sizeOffBand
        ? "Pick one of the listed employee ranges."
      : emptyHardFilter
        ? "One of the hard filters is empty — fill it in or remove it."
        : dirty
          ? "You have unsaved edits. Save them first so research uses the version you're looking at."
          : undefined,
    edit_icp:
      sizeInvalid || sizeOffBand || emptyHardFilter || geographyInvalid || industryInvalid
        ? "Fix the highlighted fields first."
        : undefined,
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Industry"
          error={industryInvalid ? "That isn't an industry the search recognises." : undefined}
        >
          <input
            className={inputClass}
            value={draft.industry}
            onChange={(e) => update("industry", e.target.value)}
          />
        </Field>
        <Field
          label="Geography"
          error={geographyInvalid ? "That isn't a place we can search." : undefined}
        >
          <input
            className={inputClass}
            list="known-places-icp"
            autoComplete="off"
            value={draft.geography}
            onChange={(e) => update("geography", e.target.value)}
          />
          <datalist id="known-places-icp">
            {KNOWN_PLACES.map((place) => (
              <option key={place} value={place} />
            ))}
          </datalist>
        </Field>
        <Field
          label="Employees"
          hint="The search provider only filters by these exact bands."
          error={
            sizeInvalid
              ? "Minimum must be below the maximum."
              : sizeOffBand
                ? "Pick one of the listed employee ranges."
                : undefined
          }
        >
          <select
            className={inputClass}
            value={sizeBand ?? ""}
            onChange={(e) => setSizeBand(e.target.value)}
          >
            {sizeBand === null ? (
              <option value="" disabled>
                Custom range ({draft.minEmployees}–{draft.maxEmployees}) — pick a band
              </option>
            ) : null}
            {COMPANY_SIZE_BANDS.map((band) => (
              <option key={band.label} value={band.label}>
                {band.label} employees
              </option>
            ))}
          </select>
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
          ctx={{ hasIcp: true, hasLeads: false }}
          changeKey={changeKey}
          live={false}
          blocked={blocked}
          payloadFor={() => {
            // The button that reaches here is disabled while industryInvalid
            // or sizeInvalid is true, so these should always resolve — the
            // `?? draft.x` fallback only guards the type, not a real path.
            const industryEntry = canonicalIndustry(draft.industry);
            const band = companySizeBandFor(draft.minEmployees, draft.maxEmployees);
            return {
              icp: {
                ...draft,
                industry: industryEntry?.label ?? draft.industry,
                industryId: industryEntry?.id ?? draft.industryId,
                companySizeBand: band ?? draft.companySizeBand,
              },
            };
          }}
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
