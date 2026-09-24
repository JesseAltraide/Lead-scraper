import { NextResponse } from "next/server";
import { serviceClient, requireUser } from "@/lib/supabase-server";
import { intakeFormSchema } from "@/lib/icp";
import { runClarityCheck } from "@/lib/clarityCheck";

/**
 * Phase 1 — create a run from the submitted form, then run ONE Claude call to
 * check the form's quality.
 *
 * The run is created FIRST, at status `refining`, so the "one active run per
 * user" index decides who wins a double-submit before any money is spent. A
 * second overlapping request fails the insert and gets a clear answer.
 */

/**
 * Starting limits. Previously deliberately tiny (4 companies / 3 reads) to
 * check real cost before scaling; raised now that the actor and the cost per
 * run are both confirmed.
 *
 * max_tool_calls is NOT a round number — it is derived from what a full run at
 * these limits actually needs, because a cap below that halts the agent
 * mid-run and reports a partial result for no reason but arithmetic:
 *   ~3 discover + ~3 screen + 20 scrapes + 20 qualifications
 *   + 4 draft pieces x up to 10 qualified leads (40) + quality + finish ~= 90.
 * 120 leaves headroom for refusals and retries without being unbounded.
 */
const STARTING_LIMITS = {
  max_candidates: 4,
  max_scrapes: 3,
  max_agent_turns: 150,
  max_tool_calls: 120,
};

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = intakeFormSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That form isn't valid." },
      { status: 400 },
    );
  }

  const form = parsed.data;
  const db = serviceClient();

  const { data: run, error } = await db
    .from("runs")
    .insert({
      user_id: user.id,
      status: "refining",
      form,
      target_leads: form.leadsWanted,
      ...STARTING_LIMITS,
    })
    .select("id")
    .single();

  if (error) {
    // The partial unique index refused a second active run for this user.
    if (error.code === "23505") {
      const { data: existing } = await db
        .from("runs")
        .select("id")
        .eq("user_id", user.id)
        .in("status", ["refining", "awaiting_clarification", "icp_ready", "researching"])
        .maybeSingle();

      return NextResponse.json(
        {
          error: "You already have a run in progress. Finish or cancel it first.",
          run_id: existing?.id,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await runClarityCheck(run.id, form);
  return NextResponse.json({ run_id: run.id });
}
