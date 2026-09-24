import { NextResponse } from "next/server";
import { serverClient, serviceClient, requireUser } from "@/lib/supabase-server";

/**
 * Marks the chosen version of one piece as reviewed. Not a guard RPC like the
 * others in this folder — "reviewed" is a plain reviewer-facing flag, not a
 * budget or state-transition rule, so a direct update (after the same
 * ownership check every route here uses) is proportionate. It only ever
 * targets the version's OWN id, and choose_draft_version is the only thing
 * that can reset it — this route cannot un-review a version, by design.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; leadId: string; versionId: string }> },
) {
  const { id: runId, leadId, versionId } = await params;

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const supabase = await serverClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("run_id", runId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  const db = serviceClient();
  const { data: version } = await db
    .from("draft_versions")
    .select("id, draft_pieces!inner(lead_id)")
    .eq("id", versionId)
    .eq("draft_pieces.lead_id", leadId)
    .maybeSingle();
  if (!version) return NextResponse.json({ error: "Version not found." }, { status: 404 });

  const { error } = await db.from("draft_versions").update({ reviewed: true }).eq("id", versionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
