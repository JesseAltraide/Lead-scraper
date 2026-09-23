import { notFound, redirect } from "next/navigation";
import { serverClient, requireUser } from "@/lib/supabase-server";
import { RUN_STATES, isRunStatus, type RunStatus } from "@/lib/runStates";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { RunActions } from "@/components/RunActions";
import { IcpEditor } from "@/components/IcpEditor";
import { ClarifyForm } from "@/components/ClarifyForm";
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

const LEAD_LABEL: Record<string, string> = {
  qualified: "Good fit",
  needs_review: "Couldn't fully check",
  not_qualified: "Not a fit",
};

const LEAD_TONE: Record<string, string> = {
  qualified: "done",
  needs_review: "waiting",
  not_qualified: "neutral",
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
      .select("id, company_name, domain, employee_count, location, industry, stage, stage_reason")
      .eq("run_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("leads")
      .select("id, company_name, domain, status, confidence, confidence_basis")
      .eq("run_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("run_events")
      .select("kind, reason, status_to, created_at")
      .eq("run_id", id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const allCandidates = candidates ?? [];
  const allLeads = leads ?? [];
  const qualified = allLeads.filter((l) => l.status === "qualified");
  const needsReview = allLeads.filter((l) => l.status === "needs_review");

  // What this run actually CONTAINS, which decides what is possible alongside
  // its status. A run cancelled during the clarifying questions has no ICP, so
  // every action needing one is impossible whatever the status says.
  const ctx = { hasIcp: Boolean(run.icp), hasLeads: allLeads.length > 0 };

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
          <CardHeader title="What we'll search for" meta="Editable until you start" />
          <div className="px-5 py-5">
            <IcpEditor runId={id} status={status} icp={run.icp as Icp} changeKey={changeKey} />
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

      {/* --- Budget ------------------------------------------------------- */}

      {status !== "refining" && status !== "awaiting_clarification" ? (
        <Card>
          <CardHeader title="Limits" meta="Enforced by the tools, read from this run" />
          <dl className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-4">
            <Meter label="Companies found" used={run.candidates_pulled} cap={run.max_candidates} />
            <Meter label="Websites read" used={run.scrapes_used} cap={run.max_scrapes} />
            <Meter label="Tool calls" used={run.tool_calls_used} cap={run.max_tool_calls} />
            <Meter label="Qualified leads" used={qualified.length} cap={run.target_leads} />
          </dl>
        </Card>
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
                      {[c.domain, c.employee_count ? `${c.employee_count} staff` : null, c.location]
                        .filter(Boolean)
                        .join(" · ") || "no details returned"}
                    </p>
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

      {allLeads.length > 0 ? (
        <Card>
          <CardHeader
            title="Leads"
            meta={`${qualified.length} qualified · ${needsReview.length} need review`}
          />
          <ul className="divide-y divide-[var(--border)]" id="review">
            {allLeads.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.company_name}</p>
                  <p className="truncate text-xs text-[var(--text-muted)]">
                    {l.confidence_basis}
                  </p>
                </div>
                <span className="text-sm tabular-nums text-[var(--text-muted)]">
                  {l.confidence}
                </span>
                <Badge tone={LEAD_TONE[l.status] ?? "neutral"}>
                  {LEAD_LABEL[l.status] ?? l.status}
                </Badge>
              </li>
            ))}
          </ul>
          {needsReview.length > 0 ? (
            <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--text-muted)]">
              Leads needing review are shown with their evidence but can&apos;t be promoted to qualified
              here — a qualified lead needs every hard filter confirmed, and promoting one by hand
              would create a “qualified” lead with nothing behind it. They don&apos;t count toward the
              target.
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* --- Recent events ------------------------------------------------ */}

      {events && events.length > 0 ? (
        <Card>
          <CardHeader title="Recent activity" />
          <ul className="divide-y divide-[var(--border)]">
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
        </Card>
      ) : null}
    </main>
  );
}

function Meter({ label, used, cap }: { label: string; used: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const atCap = used >= cap;
  return (
    <div className="bg-[var(--surface)] px-5 py-3.5">
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
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
