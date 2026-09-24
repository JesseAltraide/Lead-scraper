import type { Icp } from "@/lib/icp";

/**
 * Pure display of an ICP's fields — extracted from IcpSummary.tsx so Phase 7's
 * review screen can show "the run's ICP (including hard vs soft split)"
 * (full-flow.md) at every post-icp_ready status, not only on the confirm
 * screen. No actions here; IcpSummary wraps this with RunActions for the
 * confirm screen specifically.
 */
export function IcpFields({ icp }: { icp: Icp }) {
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
