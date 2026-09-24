import { NextResponse } from "next/server";
import { serverClient, serviceClient, requireUser } from "@/lib/supabase-server";

/**
 * "The user chooses which version is the chosen one" (full-flow.md).
 * "Reviewed" belongs to a specific version, so choosing a different one
 * resets it to unreviewed — enforced inside choose_draft_version itself
 * (supabase/migrations/0002_guards.sql), not duplicated here.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; leadId: string; versionId: string }> },
) {
  const { id: runId, leadId, versionId } = await params;

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // RLS-scoped read establishes ownership before the service-role write, same
  // pattern as every other mutating route in this app.
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
    .select("id, piece_id, draft_pieces!inner(lead_id)")
    .eq("id", versionId)
    .eq("draft_pieces.lead_id", leadId)
    .maybeSingle();
  if (!version) return NextResponse.json({ error: "Version not found." }, { status: 404 });

  const { data, error } = await db.rpc("choose_draft_version", { p_version_id: versionId });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, version: data });
}
