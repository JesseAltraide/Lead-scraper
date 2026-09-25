import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { serverClient, getAuthState } from "@/lib/supabase-server";
import { Badge, Card, EmptyState } from "@/components/ui";
import { LeadRow } from "@/components/LeadRow";
import { RefreshOnMount } from "@/components/RefreshOnMount";
import { ExportButton } from "@/components/ExportButton";
import {
  LEAD_TABS,
  TAB_LABEL,
  LEAD_TONE,
  type FilterResult,
  type LeadTab,
} from "@/lib/leadDisplay";
import type { DraftPiece, DraftVersion } from "@/lib/drafts";

export const dynamic = "force-dynamic";

/**
 * The dedicated leads page: three tabs (Qualified / Not sure / Not
 * qualified), each showing that status's leads with full Evidence +
 * (qualified only) Outreach-drafts detail.
 *
 * Split out from the run page specifically because that page was getting
 * overloaded once several leads each rendered a full Evidence panel plus a
 * four-piece drafts panel inline — the run page keeps status/ICP/limits/
 * companies and links here once there is anything to review.
 */
export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;

  const { user, offline } = await getAuthState();
  // Same reasoning as the homepage: a dropped connection must not look like
  // a logged-out visitor and send someone with a valid session to sign-in.
  if (!user && offline) {
    return (
      <main className="mx-auto w-full max-w-4xl px-5 py-10">
        <EmptyState
          title="Can't reach the server"
          detail="This looks like a connection problem, not a sign-in issue. Check your internet connection and reload."
        />
      </main>
    );
  }
  if (!user) redirect("/sign-in");

  const supabase = await serverClient();

  // RLS means this can only ever return a run belonging to the signed-in user.
  const { data: run } = await supabase
    .from("runs")
    .select("id, target_leads")
    .eq("id", id)
    .maybeSingle();
  if (!run) notFound();

  const { data: leads } = await supabase
    .from("leads")
    .select(
      "id, company_name, domain, status, confidence, confidence_basis, fit_reasons, concerns, source_urls, source_summary",
    )
    .eq("run_id", id)
    .order("confidence", { ascending: false });

  const allLeads = leads ?? [];
  const activeTab: LeadTab = LEAD_TABS.includes(tabParam as LeadTab)
    ? (tabParam as LeadTab)
    : "qualified";

  const countFor = (tab: LeadTab) => allLeads.filter((l) => l.status === tab).length;
  const tabLeads = allLeads.filter((l) => l.status === activeTab);

  const allLeadIds = allLeads.map((l) => l.id);
  const { data: filterResults } = allLeadIds.length
    ? await supabase
        .from("lead_filter_results")
        .select(
          "lead_id, filter_key, filter_text, verdict, evidence, evidence_source_url, evidence_kind",
        )
        .in("lead_id", allLeadIds)
    : { data: [] as FilterResult[] };
  const filtersByLead = new Map<string, FilterResult[]>();
  for (const f of filterResults ?? []) {
    filtersByLead.set(f.lead_id, [...(filtersByLead.get(f.lead_id) ?? []), f as FilterResult]);
  }

  // Every lead with a draft shows it, regardless of status — fetch for all.
  const draftableIds = allLeads.map((l) => l.id);
  const { data: draftPieces } = draftableIds.length
    ? await supabase
        .from("draft_pieces")
        .select(
          "id, lead_id, piece_key, rewrites_requested, rewrite_in_flight, rewrite_claimed_at, edits_requested",
        )
        .in("lead_id", draftableIds)
    : { data: [] as DraftPiece[] };
  const piecesByLead = new Map<string, DraftPiece[]>();
  for (const p of draftPieces ?? []) {
    piecesByLead.set(p.lead_id, [...(piecesByLead.get(p.lead_id) ?? []), p as DraftPiece]);
  }

  const pieceIds = (draftPieces ?? []).map((p) => p.id);
  const { data: draftVersions } = pieceIds.length
    ? await supabase
        .from("draft_versions")
        .select(
          "id, piece_id, subject, body, personalization_note, citation_source_url, citation_fact, origin, rewrite_note, is_chosen, reviewed, created_at",
        )
        .in("piece_id", pieceIds)
    : { data: [] as DraftVersion[] };
  const versionsByPiece = new Map<string, DraftVersion[]>();
  for (const v of draftVersions ?? []) {
    versionsByPiece.set(v.piece_id, [...(versionsByPiece.get(v.piece_id) ?? []), v as DraftVersion]);
  }

  // A draft_pieces row can exist while still claimed/in-flight with no
  // chosen version yet — only a chosen version is actually something the
  // export route will write out, so that (not just piece existence, and not
  // just the run's own status) is what decides whether there is anything to
  // export. Migration 0015 lets a run land on completed/completed_partial
  // with budget exhausted before any draft was ever written (e.g. stopped
  // mid-run with zero qualified leads), so status alone isn't enough here.
  //
  // Beyond that: exporting is for handing reviewed copy to someone, so it
  // also stays hidden until at least one chosen version has actually been
  // looked at (reviewed=true, set by the "mark reviewed" action on the
  // review screen) — a run full of unread AI drafts isn't ready to leave
  // this app yet, even if drafts technically exist.
  const hasExportableDraft = (draftVersions ?? []).some((v) => v.is_chosen && v.reviewed);

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-5 py-10">
      <RefreshOnMount />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/runs/${id}`}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            ← Back to run
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Leads</h1>
        </div>
        {hasExportableDraft ? (
          <ExportButton runId={id} />
        ) : (
          <span className="text-xs text-[var(--text-muted)]">
            You won&apos;t be able to export until at least one draft is marked reviewed.
          </span>
        )}
      </header>

      <Card>
        <nav className="flex border-b border-[var(--border)]" aria-label="Lead status">
          {LEAD_TABS.map((tab) => (
            <Link
              key={tab}
              href={`/runs/${id}/leads?tab=${tab}`}
              // Each tab is a real page reached via a query string, not a
              // client-side tab widget — aria-current="page" is the correct
              // semantic for "one of several links, this one is the current
              // view", which is what these actually are.
              aria-current={tab === activeTab ? "page" : undefined}
              className="flex-1 border-b-2 px-4 py-3 text-center text-sm font-medium transition-colors"
              style={{
                borderColor: tab === activeTab ? "var(--accent)" : "transparent",
                color: tab === activeTab ? "var(--text)" : "var(--text-muted)",
              }}
            >
              {TAB_LABEL[tab]} <Badge tone={LEAD_TONE[tab]}>{countFor(tab)}</Badge>
            </Link>
          ))}
        </nav>

        {tabLeads.length > 0 ? (
          <ul className="divide-y divide-[var(--border)]">
            {tabLeads.map((l) => (
              <LeadRow
                key={l.id}
                runId={id}
                lead={l}
                filters={filtersByLead.get(l.id) ?? []}
                pieces={piecesByLead.get(l.id) ?? []}
                versionsByPiece={Object.fromEntries(
                  (piecesByLead.get(l.id) ?? []).map((p) => [p.id, versionsByPiece.get(p.id) ?? []]),
                )}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            title={`No ${TAB_LABEL[activeTab].toLowerCase()} leads`}
            detail={
              activeTab === "qualified"
                ? "None have qualified yet — check the other tabs, or the run's own status."
                : activeTab === "needs_review"
                  ? "No leads are waiting on evidence that couldn't be confirmed."
                  : "No leads have been ruled out."
            }
          />
        )}

        {activeTab === "needs_review" && tabLeads.length > 0 ? (
          <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--text-muted)]">
            These leads can&apos;t be promoted to qualified here — a qualified lead needs every hard
            filter confirmed, and promoting one by hand would create a &quot;qualified&quot; lead with
            nothing behind it. They don&apos;t count toward the target.
          </p>
        ) : null}
      </Card>
    </main>
  );
}
