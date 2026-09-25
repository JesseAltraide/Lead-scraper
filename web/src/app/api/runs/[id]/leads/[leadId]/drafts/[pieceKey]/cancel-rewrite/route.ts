import { NextResponse } from "next/server";
import { serverClient, serviceClient, requireUser } from "@/lib/supabase-server";
import { PIECE_KEYS, type PieceKey } from "@/lib/drafts";
import { draftActionAvailability } from "@/lib/draftStates";

/**
 * Cancels a rewrite that never finished, so the piece is usable again.
 *
 * Without this, a rewrite whose process died left `rewrite_in_flight` stuck
 * true and the piece unrewritable until the database's own stale window
 * elapsed — a dead end with a disabled button and no explanation.
 *
 * It releases the slot as a FAILURE (`p_succeeded => false`), which is what
 * refunds `rewrites_requested`: an attempt that produced nothing must not cost
 * the user one of their three.
 *
 * Whether this is allowed at all is decided by draftStates.ts — the same
 * function the screen uses to decide whether to show the button, so the two
 * cannot disagree.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; leadId: string; pieceKey: string }> },
) {
  const { id: runId, leadId, pieceKey } = await params;

  if (!PIECE_KEYS.includes(pieceKey as PieceKey)) {
    return NextResponse.json({ error: "Unknown draft piece." }, { status: 404 });
  }

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // RLS scopes this to the signed-in user's own run.
  const supabase = await serverClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("run_id", runId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  const db = serviceClient();
  const { data: piece } = await db
    .from("draft_pieces")
    .select("id, rewrites_requested, rewrite_in_flight, rewrite_claimed_at, edits_requested")
    .eq("lead_id", leadId)
    .eq("piece_key", pieceKey)
    .maybeSingle();

  if (!piece) {
    return NextResponse.json(
      { error: "There's no draft for this piece yet, so there's nothing to cancel." },
      { status: 404 },
    );
  }

  // Re-checked here against the state as it is RIGHT NOW, not as the screen
  // last saw it: the rewrite may have completed between the render and this
  // click. The refusal carries its own next step.
  const allowed = draftActionAvailability("cancel_rewrite", {
    rewritesRequested: piece.rewrites_requested,
    rewriteInFlight: piece.rewrite_in_flight,
    rewriteClaimedAt: piece.rewrite_claimed_at,
    editsRequested: piece.edits_requested,
  }, Date.now());
  if (!allowed.available) {
    return NextResponse.json({ error: allowed.reason }, { status: 409 });
  }

  const { error } = await db.rpc("release_rewrite_slot", {
    p_piece_id: piece.id,
    p_succeeded: false,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
