import { NextResponse } from "next/server";
import { z } from "zod";
import { serverClient, serviceClient, requireUser } from "@/lib/supabase-server";
import { PIECE_KEYS, PIECE_LABELS, type PieceKey } from "@/lib/drafts";
import { checkEditQuality } from "@/lib/copyQualityCheck";
import type { Icp } from "@/lib/icp";

/**
 * Direct edit of an outreach draft (full-flow.md "Editing and rewriting
 * drafts": "the person editing *is* the reviewer", originally no AI check).
 *
 * Deliberately reversed at the user's explicit request: a human retyping a
 * draft can reintroduce weak, generic, or unverifiable copy just as easily as
 * the agent could, so every edit is now judged against the same
 * outbound-copywriting-guide.md checklist the agent's own drafts and every
 * rewrite are held to (checkEditQuality). citation_fact/citation_source_url
 * are still carried forward unchanged — only subject/body/personalization_note
 * are exposed as editable, and this creates a new version (never overwrites),
 * same as an agent-written draft or a rewrite: "every version is kept."
 */

const bodySchema = z.object({
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().min(1, "The message can't be empty."),
  personalization_note: z.string().trim().min(1, "The personalization note can't be empty."),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; leadId: string; pieceKey: string }> },
) {
  const { id: runId, leadId, pieceKey } = await params;

  if (!PIECE_KEYS.includes(pieceKey as PieceKey)) {
    return NextResponse.json({ error: "Unknown draft piece." }, { status: 404 });
  }

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // RLS scopes this to the signed-in user's own run — the only ownership
  // check this route needs, matching the pattern in
  // app/api/runs/[id]/[action]/route.ts.
  const supabase = await serverClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, status, source_urls, source_summary")
    .eq("id", leadId)
    .eq("run_id", runId)
    .maybeSingle();

  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  const { data: run } = await supabase.from("runs").select("icp").eq("id", runId).maybeSingle();
  const icp = run?.icp as Icp | null;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That edit isn't valid." },
      { status: 400 },
    );
  }

  const db = serviceClient();

  const { data: piece } = await db
    .from("draft_pieces")
    .select("id")
    .eq("lead_id", leadId)
    .eq("piece_key", pieceKey)
    .maybeSingle();

  if (!piece) {
    return NextResponse.json(
      { error: "There's no draft for this piece yet — nothing to edit." },
      { status: 404 },
    );
  }

  const { data: current } = await db
    .from("draft_versions")
    .select("citation_source_url, citation_fact")
    .eq("piece_id", piece.id)
    .eq("is_chosen", true)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "No current version to edit." }, { status: 404 });
  }

  if (pieceKey.startsWith("email") && !parsed.data.subject) {
    return NextResponse.json({ error: "An email piece needs a subject line." }, { status: 400 });
  }

  const quality = await checkEditQuality({
    pieceLabel: PIECE_LABELS[pieceKey as PieceKey],
    subject: parsed.data.subject ?? null,
    body: parsed.data.body,
    personalizationNote: parsed.data.personalization_note,
    citationFact: current.citation_fact,
    citationSourceUrl: current.citation_source_url,
    sourceSummary: lead.source_summary ?? "",
    sourceUrls: lead.source_urls ?? [],
    buyerPersona: icp?.buyerPersona ?? "",
    businessProblem: icp?.businessProblem ?? "",
  });
  if (!quality.ok) {
    return NextResponse.json({ error: quality.reason }, { status: 422 });
  }

  const { data: version, error } = await db.rpc("save_outreach_draft", {
    p_lead_id: leadId,
    p_piece_key: pieceKey,
    p_subject: parsed.data.subject ?? null,
    p_body: parsed.data.body,
    p_personalization_note: parsed.data.personalization_note,
    p_citation_source_url: current.citation_source_url,
    p_citation_fact: current.citation_fact,
    p_origin: "edit",
    p_rewrite_note: null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, version });
}
