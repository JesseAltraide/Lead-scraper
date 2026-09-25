import { NextResponse } from "next/server";
import { serverClient, requireUser } from "@/lib/supabase-server";
import { renderLeadsDocx, type ExportData } from "@/lib/exportDocx";
import type { DraftPiece, DraftVersion } from "@/lib/drafts";
import type { Icp } from "@/lib/icp";

// Drafts only ever exist once check_list_quality has run, which only ever
// happens on the way to one of these two statuses — exporting any earlier
// (e.g. mid-`researching`) would hand back a file with qualified leads and no
// drafts, which reads as broken rather than in-progress.
const DRAFTS_READY_STATUSES = new Set(["completed", "completed_partial"]);

/**
 * Exports a run's leads as a Word document, grouped the same way the leads
 * page is (Qualified / Not sure / Not qualified) — qualified leads also carry
 * their four outreach drafts, so the file is genuinely usable outside the app
 * (a reviewer's own desktop, or handed to someone without an account) rather
 * than just a dump of the database.
 *
 * Read-only: this never writes anything, so it needs only the same
 * RLS-scoped ownership check every read-only route in this app uses.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const supabase = await serverClient();

  const { data: run } = await supabase.from("runs").select("id, status, icp").eq("id", id).maybeSingle();
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  if (!DRAFTS_READY_STATUSES.has(run.status)) {
    return NextResponse.json(
      { error: "Drafts aren't ready yet — export becomes available once the run finishes." },
      { status: 409 },
    );
  }

  const { data: leads } = await supabase
    .from("leads")
    .select("id, company_name, domain, status")
    .eq("run_id", id)
    .order("confidence", { ascending: false });
  const allLeads = leads ?? [];

  // Every lead with a draft gets it exported, regardless of status — fetch
  // for all of them rather than pre-filtering by status.
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

  // A run can reach completed/completed_partial with zero drafts ever
  // written (migration 0015 allows completing on budget exhaustion even with
  // nothing qualified yet) — the leads page hides the export link for that
  // case, but this refuses it directly too, so hitting the URL by hand or a
  // stale link never hands back a document with nothing in it. Beyond that,
  // exporting is for handing reviewed copy to someone, so it also requires at
  // least one chosen version to have actually been looked at (reviewed=true)
  // — matches the same gate the leads page uses to decide whether to show
  // the link at all.
  const hasReviewedDraft = (draftVersions ?? []).some((v) => v.is_chosen && v.reviewed);
  if (!hasReviewedDraft) {
    return NextResponse.json(
      { error: "Nothing has been marked reviewed yet — there's nothing ready to export." },
      { status: 409 },
    );
  }

  const icp = run.icp as Icp | null;
  const runLabel = icp ? `${icp.industry}, ${icp.geography}` : `Run ${id.slice(0, 8)}`;

  const exportData: ExportData = {
    runLabel,
    leads: allLeads,
    piecesByLead,
    versionsByPiece,
  };

  const buffer = await renderLeadsDocx(exportData);

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="leads-${id.slice(0, 8)}.docx"`,
    },
  });
}
