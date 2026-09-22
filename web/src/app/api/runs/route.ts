import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { serviceClient, requireUser } from "@/lib/supabase-server";
import { intakeFormSchema, icpFromForm, type IntakeForm } from "@/lib/icp";

/**
 * Phase 1 — create a run from the submitted form, then run ONE Claude call to
 * check the form's quality.
 *
 * The run is created FIRST, at status `refining`, so the "one active run per
 * user" index decides who wins a double-submit before any money is spent. A
 * second overlapping request fails the insert and gets a clear answer.
 */

/** Starting limits. Deliberately tiny: test small, check real cost, then scale. */
const STARTING_LIMITS = {
  max_candidates: 4,
  max_scrapes: 3,
  max_agent_turns: 30,
  max_tool_calls: 40,
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

type ClarityVerdict = {
  ok: boolean;
  questions: { field: string; question: string; why?: string }[];
  normalized?: Partial<IntakeForm>;
};

/**
 * The one AI call in Phase 1. It checks the form for vague answers,
 * contradictions, and must-haves nothing could ever confirm.
 *
 * It never fails the run: if the model is unavailable or returns something
 * unusable, the run proceeds to `icp_ready` with the user's own answers. The
 * user reviews and edits the ICP on that screen anyway, so a missing quality
 * check costs a suggestion — not a way forward. Leaving the run stuck in
 * `refining` with no exit would be the far worse outcome.
 */
async function runClarityCheck(runId: string, form: IntakeForm) {
  const db = serviceClient();
  const icp = icpFromForm(form);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.startsWith("REPLACE_ME")) {
    await finalize(runId, icp, "No ANTHROPIC_API_KEY set — the form was accepted as written.");
    return;
  }

  try {
    const client = new Anthropic({ apiKey: key });

    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1200,
      system: [
        "You check a lead-research intake form for quality before any paid search runs.",
        "",
        "Flag ONLY these three things:",
        "1. Vague answers that cannot be searched ('tech', 'decision makers', 'efficiency').",
        "2. Contradictions between fields (e.g. 10-100 employees alongside 'skip if: startups').",
        "3. Must-haves that no company database or public website could ever confirm",
        "   (budget, internal tooling, dissatisfaction with a current vendor).",
        "",
        "Do NOT reclassify the user's hard/soft/skip choices — they stated those deliberately.",
        "Do NOT ask about the buyer persona's specificity: the persona shapes the outreach copy,",
        "it is never searched for, so 'Head of Operations' is perfectly sufficient.",
        "",
        "Each question must name exactly one field and say what would make it answerable.",
        "If the form is workable, return ok: true with an empty questions array. A form does not",
        "have to be perfect — only searchable.",
        "",
        'Reply with JSON only: {"ok": boolean, "questions": [{"field": string, "question": string, "why": string}]}',
      ].join("\n"),
      messages: [{ role: "user", content: JSON.stringify(form, null, 2) }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Normalise at the boundary: the reply can arrive fenced, prefixed, or
    // truncated. A parse failure is not a reason to strand the run.
    const json = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const verdict = JSON.parse(json) as ClarityVerdict;

    const questions = Array.isArray(verdict.questions) ? verdict.questions.slice(0, 5) : [];

    if (verdict.ok || questions.length === 0) {
      await finalize(runId, icp, "The form was clear enough to search.");
      return;
    }

    const { data } = await db
      .from("runs")
      .update({ status: "awaiting_clarification", pending_questions: questions })
      .eq("id", runId)
      .eq("status", "refining")
      .select("id")
      .maybeSingle();

    if (data) {
      await db.from("run_events").insert({
        run_id: runId,
        kind: "status_change",
        status_to: "awaiting_clarification",
        reason: `${questions.length} question(s) about the form.`,
      });
    }
  } catch (err) {
    await finalize(
      runId,
      icp,
      `The form check couldn't run (${err instanceof Error ? err.message : "unknown error"}) — your answers were accepted as written. Review them below before starting.`,
    );
  }
}

/** Moves the run to `icp_ready`. Conditional on it still being `refining`. */
async function finalize(runId: string, icp: unknown, reason: string) {
  const db = serviceClient();
  const { data } = await db
    .from("runs")
    .update({ status: "icp_ready", icp, icp_finalized_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("status", "refining")
    .select("id")
    .maybeSingle();

  if (data) {
    await db.from("run_events").insert({
      run_id: runId,
      kind: "status_change",
      status_to: "icp_ready",
      reason,
    });
  }
}
