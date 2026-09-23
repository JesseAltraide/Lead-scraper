"use client";

import type { Icp } from "@/lib/icp";
import type { RunStatus } from "@/lib/runStates";
import { RunActions } from "./RunActions";

/**
 * The confirm screen at `icp_ready` — view only.
 *
 * Formerly editable (see git history: IcpEditor.tsx). Changed per Decision
 * #60: PRD.md, unlike week5-full-flow.md's original design, never specifies
 * that this screen must allow editing — it only requires the run record show
 * the refined ICP before searching (PRD test #1). Given that, every value
 * shown here has already passed exactly the same validation the intake form
 * enforces (industry taxonomy, persona vagueness/gibberish, company-size
 * band, gibberish-free text on every free-text field) to have reached this
 * screen at all, so there is no case where in-place editing was ever needed
 * to fix something invalid — it can't be invalid by construction. Wanting
 * something different means starting a new search with different answers,
 * not patching this one.
 *
 * This does reverse Decision #23 (full-flow.md's "the user can still edit
 * any of it", made in direct response to prior graded feedback about not
 * letting the system decide something the user can't override). That
 * tradeoff is deliberate and stated here, not silently dropped.
 */
export function IcpSummary({
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
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <SummaryField label="Industry" value={icp.industry} />
        <SummaryField label="Geography" value={icp.geography} />
        <SummaryField
          label="Employees"
          value={icp.companySizeBand ? `${icp.companySizeBand} employees` : `${icp.minEmployees}–${icp.maxEmployees} employees`}
        />
        <SummaryField label="Buyer persona" value={icp.buyerPersona} />
      </div>

      <SummaryField label="Business problem" value={icp.businessProblem} block />

      <div>
        <p className="mb-1.5 text-sm font-medium">Hard filters</p>
        <p className="mb-2.5 text-xs text-[var(--text-muted)]">
          Every one of these must be confirmed by evidence for a company to qualify.
        </p>
        <ul className="space-y-1.5">
          {icp.hardFilters.map((f) => (
            <li
              key={f.key}
              className="rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-sm"
            >
              {f.text}
            </li>
          ))}
        </ul>
      </div>

      <SummaryList
        label="Nice to have"
        hint="These change the confidence score. They never disqualify a company."
        items={icp.niceToHave}
      />

      <SummaryList
        label="Skip if"
        hint="These rule a company out only when there is positive evidence. “Can't tell” is never a reason."
        items={icp.skipIf}
      />

      {icp.notes ? <SummaryField label="Anything else" value={icp.notes} block /> : null}

      <div className="border-t border-[var(--border)] pt-4">
        <RunActions
          runId={runId}
          status={status}
          ctx={{ hasIcp: true, hasLeads: false }}
          changeKey={changeKey}
          live={false}
        />
      </div>
    </div>
  );
}

function SummaryField({ label, value, block = false }: { label: string; value: string; block?: boolean }) {
  return (
    <div className={block ? "sm:col-span-2" : undefined}>
      <p className="mb-1 text-sm font-medium">{label}</p>
      <p className="text-sm text-[var(--text-muted)]">{value}</p>
    </div>
  );
}

function SummaryList({ label, hint, items }: { label: string; hint: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <p className="mb-2.5 text-xs text-[var(--text-muted)]">{hint}</p>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <li
            key={`${item}-${i}`}
            className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs text-[var(--text-muted)]"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
