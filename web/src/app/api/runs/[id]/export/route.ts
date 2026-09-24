import { NextResponse } from "next/server";
import { serverClient, requireUser } from "@/lib/supabase-server";
import { renderLeadsDocx, type ExportData } from "@/lib/exportDocx";
import type { FilterResult } from "@/lib/leadDisplay";
import type { DraftPiece, DraftVersion } from "@/lib/drafts";
import type { Icp } from "@/lib/icp";

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

  const { data: run } = await supabase.from("runs").select("id, icp").eq("id", id).maybeSingle();
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const { data: leads } = await supabase
    .from("leads")
    .select(
      "id, company_name, domain, status, confidence, confidence_basis, fit_reasons, concerns, source_urls, source_summary",
    )
    .eq("run_id", id)
    .order("confidence", { ascending: false });
  const allLeads = leads ?? [];

  const leadIds = allLeads.map((l) => l.id);
  const { data: filterResults } = leadIds.length
    ? await supabase
        .from("lead_filter_results")
        .select(
          "lead_id, filter_key, filter_text, verdict, evidence, evidence_source_url, evidence_kind",
        )
        .in("lead_id", leadIds)
    : { data: [] as FilterResult[] };
  const filtersByLead = new Map<string, FilterResult[]>();
  for (const f of filterResults ?? []) {
    filtersByLead.set(f.lead_id, [...(filtersByLead.get(f.lead_id) ?? []), f as FilterResult]);
  }

  const qualifiedIds = allLeads.filter((l) => l.status === "qualified").map((l) => l.id);
  const { data: draftPieces } = qualifiedIds.length
    ? await supabase
        .from("draft_pieces")
        .select("id, lead_id, piece_key, rewrites_requested, rewrite_in_flight, rewrite_claimed_at")
        .in("lead_id", qualifiedIds)
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

  const icp = run.icp as Icp | null;
  const runLabel = icp ? `${icp.industry} — ${icp.geography}` : `Run ${id.slice(0, 8)}`;

  const exportData: ExportData = {
    runLabel,
    leads: allLeads,
    filtersByLead,
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
