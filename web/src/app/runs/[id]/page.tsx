import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { serverClient, requireUser } from "@/lib/supabase-server";
import { RUN_STATES, isRunStatus, type RunStatus } from "@/lib/runStates";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { RunActions } from "@/components/RunActions";
import { IcpSummary } from "@/components/IcpSummary";
import { ClarifyForm } from "@/components/ClarifyForm";
import { IcpFields } from "@/components/IcpFields";
import { LEAD_TABS, TAB_LABEL, LEAD_TONE } from "@/lib/leadDisplay";
import type { Icp } from "@/lib/icp";
import type { ClarificationItem } from "@/lib/clarityCheck";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, { text: string; tone: string }> = {
  discovered: { text: "Awaiting screen", tone: "neutral" },
  excluded_no_website: { text: "Excluded — no website", tone: "neutral" },
  screened_out: { text: "Screened out on search data", tone: "neutral" },
  queued: { text: "Queued to read", tone: "working" },
  scraping: { text: "Reading website…", tone: "working" },
  scraped: { text: "Website read", tone: "working" },
  scrape_failed: { text: "Website couldn't be read", tone: "partial" },
  qualified_done: { text: "Qualified", tone: "done" },
};

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await requireUser();
  if (!user) redirect("/sign-in");

  const supabase = await serverClient();

  // RLS means this can only ever return a run belonging to the signed-in user.
  const { data: run } = await supabase.from("runs").select("*").eq("id", id).maybeSingle();
  if (!run) notFound();

  // The status is read fresh from the database on every render, and everything
  // on this page — the headline, the buttons, the polling — derives from it.
  if (!isRunStatus(run.status)) {
    // A status with no row in the table would be a dead end, which is exactly
    // the failure this design exists to prevent. Say so instead of rendering a
    // blank screen with no way forward.
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <Card>
          <CardHeader title="This run is in an unrecognised state" />
          <div className="px-5 py-6 text-sm text-[var(--text-muted)]">
            <p>
              The run&apos;s status is <code className="font-mono">{String(run.status)}</code>, which has
              no screen defined for it. This is a bug, not something you did.
            </p>
            <p className="mt-3">
              Nothing has been lost — the run&apos;s records are still in the database. Please report the
              run id <code className="font-mono">{run.id}</code>.
            </p>
          </div>
        </Card>
      </main>
    );
  }

  const status: RunStatus = run.status;
  const spec = RUN_STATES[status];

  const [{ data: candidates }, { data: leads }, { data: events }] = await Promise.all([
    supabase
      .from("candidates")
      .select(
        "id, company_name, domain, employee_count, location, industry, description, stage, stage_reason",
      )
      .eq("run_id", id)
      .order("created_at", { ascending: true }),
    // Only what's needed for the per-status counts below — the full lead
    // detail (evidence, drafts) now lives entirely on the dedicated leads page.
    supabase.from("leads").select("id, status").eq("run_id", id),
    supabase
      .from("run_events")
      .select("kind, reason, status_to, created_at")
      .eq("run_id", id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  // Written once at run start by the agent (runAgent.ts). Queried on its own
  // rather than read from the 5-row activity list, which the note falls out of
  // as soon as a run does anything.
  const { data: providerNote } = await supabase
    .from("run_events")
    .select("reason")
    .eq("run_id", id)
    .eq("kind", "note")
    .like("reason", "%Apify%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const usedFixtures = Boolean(providerNote?.reason?.includes("Apify: fixtures"));

  const allCandidates = candidates ?? [];
  const allLeads = leads ?? [];
  const qualified = allLeads.filter((l) => l.status === "qualified");

  // What this run actually CONTAINS, which decides what is possible alongside
  // its status. A run cancelled during the clarifying questions has no ICP, so
  // every action needing one is impossible whatever the status says.
  const ctx = {
    hasIcp: Boolean(run.icp),
    hasLeads: allLeads.length > 0,
    continuesUsed: run.continue_count ?? 0,
  };

  // Changes whenever anything the screen displays changes, so the poll can tell
  // a refresh that landed from one that silently did nothing.
  const changeKey = [run.updated_at, run.status, allCandidates.length, allLeads.length].join("|");

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-5 py-10">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{spec.headline}</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">{spec.detail}</p>
          </div>
          <Badge tone={spec.tone} live={spec.live}>
            {spec.label}
          </Badge>
        </div>

        {/* Failure states say WHICH step failed and why, read from the run
            record and its events — never inferred from the status code. */}
        {status === "failed" && (run.failure_reason || run.failed_step) ? (
          <div
            className="rounded-[var(--radius)] px-4 py-3 text-sm"
            style={{ background: "var(--error-bg)", color: "var(--error)" }}
          >
            <p className="font-medium">
              Failed during: {run.failed_step ?? "an unrecorded step"}
            </p>
            {run.failure_reason ? <p className="mt-1">{run.failure_reason}</p> : null}
          </div>
        ) : null}

        {(status === "completed_partial" || status === "cancelled") && run.stopping_reason ? (
          <div
            className="rounded-[var(--radius)] px-4 py-3 text-sm"
            style={{ background: "var(--partial-bg)", color: "var(--partial)" }}
          >
            {run.stopping_reason}
          </div>
        ) : null}
      </header>

      {/* --- The per-status body ------------------------------------------- */}

      {status === "icp_ready" && ctx.hasIcp ? (
        <Card>
          <CardHeader title="What we'll search for" meta="Checked and ready — view only" />
          <div className="px-5 py-5">
            <IcpSummary runId={id} status={status} icp={run.icp as Icp} changeKey={changeKey} />
          </div>
        </Card>
      ) : status === "awaiting_clarification" ? (
        <Card>
          <CardHeader title="Questions about your form" />
          <div className="px-5 py-5">
            <ClarifyForm
              runId={id}
              status={status}
              findings={(run.pending_questions ?? []) as ClarificationItem[]}
              form={(run.form ?? {}) as Record<string, unknown>}
              round={run.clarification_rounds + 1}
              changeKey={changeKey}
            />
          </div>
        </Card>
      ) : (
        <Card>
          <div className="px-5 py-4">
            <RunActions
              runId={id}
              status={status}
              ctx={ctx}
              changeKey={changeKey}
              live={spec.live}
            />
          </div>
        </Card>
      )}

      {/* --- ICP (Phase 7: shown at every status once it exists, not only at
          icp_ready's confirm screen — "the run's ICP" is part of what a
          reviewer needs to see to judge the agent's decisions) ------------- */}

      {status !== "icp_ready" && ctx.hasIcp ? (
        <Card>
          <CardHeader title="What was searched for" meta="View only" />
          <div className="px-5 py-5">
            <IcpFields icp={run.icp as Icp} />
          </div>
        </Card>
      ) : null}

      {/* --- Budget ------------------------------------------------------- */}

      {status !== "refining" && status !== "awaiting_clarification" ? (
        <Card>
          <CardHeader
            title="What this run is allowed to spend"
            meta="Caps, not targets — the run stops at whichever it reaches first"
          />
          <dl className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-4">
            {/* "Companies pulled", NOT "found": this counts search results paid
                for, and duplicates are discarded afterwards. Labelling it
                "found" made 30/30 read as thirty companies when only six
                distinct ones existed. */}
            <Meter
              label="Company searches used"
              hint={`${allCandidates.length} kept after duplicates`}
              used={run.candidates_pulled}
              cap={run.max_candidates}
            />
            <Meter
              label="Websites read"
              hint="Only companies that pass the first screen"
              used={run.scrapes_used}
              cap={run.max_scrapes}
            />
            <Meter
              label="Agent steps used"
              hint="Every action the agent takes"
              used={run.tool_calls_used}
              cap={run.max_tool_calls}
            />
            <Meter
              label="Qualified leads"
              hint="Your target, not a cap"
              used={qualified.length}
              cap={run.target_leads}
            />
          </dl>
        </Card>
      ) : null}

      {/* Companies that came from the built-in fixtures are not real search
          results, and nothing else on this screen distinguishes them — which
          is exactly how a run can look like it found 30 companies while the
          Apify console shows no activity at all. */}
      {usedFixtures ? (
        <div
          className="rounded-[var(--radius)] px-4 py-3 text-sm"
          style={{ background: "var(--partial-bg)", color: "var(--partial)" }}
        >
          <p className="font-medium">These are sample companies, not a real search</p>
          <p className="mt-1">
            This run used the built-in fixture data, so nothing was searched or billed. Set
            <code className="mx-1 font-mono text-xs">APIFY_LIVE=true</code>
            in the agent&apos;s environment and start a new search to use the real company source.
          </p>
        </div>
      ) : null}

      {/* --- Companies ---------------------------------------------------- */}

      {allCandidates.length > 0 ? (
        <Card>
          <CardHeader
            title="Companies"
            meta={`${allCandidates.length} found · ${allCandidates.filter((c) => c.stage === "screened_out" || c.stage === "excluded_no_website").length} dropped before any website was read`}
          />
          <ul className="divide-y divide-[var(--border)]">
            {allCandidates.map((c) => {
              const stage = STAGE_LABEL[c.stage] ?? { text: c.stage, tone: "neutral" };
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.company_name}</p>
                    <p className="truncate text-xs text-[var(--text-muted)]">
                      {[
                        c.domain,
                        c.employee_count ? `${c.employee_count} staff` : null,
                        c.location,
                        c.industry,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "no details returned"}
                    </p>
                    {/* Phase 7: "full company details from the search" — the
                        description is the one field long enough to need its
                        own line rather than joining the summary above. */}
                    {c.description ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-faint)]">
                        {c.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <Badge tone={stage.tone}>{stage.text}</Badge>
                    {/* Why it was dropped, so the reviewer can judge the
                        decision rather than take it on trust. */}
                    {c.stage_reason ? (
                      <p className="mt-1 max-w-xs text-xs text-[var(--text-muted)]">
                        {c.stage_reason}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : spec.live ? (
        <Card>
          <EmptyState
            title="No companies yet"
            detail="They'll appear here as they're found, before any website is read."
          />
        </Card>
      ) : null}

      {/* --- Leads -------------------------------------------------------- */}
      {/* A summary and a link, not the full detail: this section used to
          render every lead's Evidence panel and Outreach-drafts panel inline,
          which made the page unusable once several leads existed. The full
          review — three tabs, Qualified / Not sure / Not qualified — lives on
          its own page now. */}

      {allLeads.length > 0 ? (
        <Card>
          <CardHeader title="Leads" />
          <div className="flex flex-wrap items-center gap-3 px-5 py-4" id="review">
            {LEAD_TABS.map((tab) => (
              <Badge key={tab} tone={LEAD_TONE[tab]}>
                {allLeads.filter((l) => l.status === tab).length} {TAB_LABEL[tab].toLowerCase()}
              </Badge>
            ))}
            <Link
              href={`/runs/${id}/leads`}
              className="ml-auto rounded-full px-3.5 py-1.5 text-sm font-medium transition-opacity hover:opacity-90"
              style={{ background: "var(--accent)", color: "var(--accent-text)" }}
            >
              See the leads
            </Link>
          </div>
        </Card>
      ) : null}

      {/* --- Recent events ------------------------------------------------ */}

      {events && events.length > 0 ? (
        <Card>
          {/* Collapsed by default: useful when something looks wrong, noise the
              rest of the time. */}
          <details>
            <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold tracking-tight">
              Recent activity
            </summary>
          <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {events.map((e, i) => (
              <li key={i} className="flex gap-4 px-5 py-2.5 text-xs">
                <span className="shrink-0 tabular-nums text-[var(--text-faint)]">
                  {new Date(e.created_at).toLocaleTimeString()}
                </span>
                <span className="text-[var(--text-muted)]">
                  {e.reason ?? `${e.kind}${e.status_to ? ` → ${e.status_to}` : ""}`}
                </span>
              </li>
            ))}
          </ul>
          </details>
        </Card>
      ) : null}
    </main>
  );
}

function Meter({
  label,
  hint,
  used,
  cap,
}: {
  label: string;
  hint?: string;
  used: number;
  cap: number;
}) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const atCap = used >= cap;
  return (
    <div className="bg-[var(--surface)] px-5 py-3.5">
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      {hint ? <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">{hint}</p> : null}
      <dd className="mt-1 text-sm font-medium tabular-nums">
        {used} <span className="text-[var(--text-faint)]">/ {cap}</span>
      </dd>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: atCap ? "var(--partial)" : "var(--text-faint)",
          }}
        />
      </div>
    </div>
  );
}
