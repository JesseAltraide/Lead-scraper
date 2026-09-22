import { NextResponse } from "next/server";
import { serverClient, serviceClient, requireUser } from "@/lib/supabase-server";
import {
  actionAllowed,
  isRunStatus,
  type RunActionId,
  type RunStatus,
} from "@/lib/runStates";
import { icpSchema } from "@/lib/icp";

/**
 * Every run action goes through here.
 *
 * The authorisation check is `actionAllowed(status, actionId)` — the exact
 * function the screen uses to decide which buttons to render, against the
 * status column read fresh from the database in this request. The screen and
 * the backend therefore cannot disagree about what is possible.
 *
 * Each handler then does its work as a CONDITIONAL update keyed on the status
 * it expects. Two overlapping requests cannot both win: the second finds no row
 * and becomes a genuine no-op, regardless of timing.
 */

const ENDPOINT_TO_ACTION: Record<string, RunActionId> = {
  cancel: "cancel",
  clarify: "answer_clarification",
  icp: "edit_icp",
  start: "start_research",
  stop: "stop_run",
  retry: "retry",
  "start-over": "start_over",
  continue: "continue_higher_limit",
};

/** Raised limits for "continue with higher limits" on a partial run. */
const RAISED_LIMITS = { max_candidates: 30, max_scrapes: 20, max_tool_calls: 80, max_agent_turns: 60 };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const actionId = ENDPOINT_TO_ACTION[action];
  if (!actionId) return NextResponse.json({ error: "Unknown action." }, { status: 404 });

  const supabase = await serverClient();

  // RLS scopes this to the signed-in user, so ownership is enforced by the
  // database rather than by a check we could forget to write.
  const { data: run } = await supabase
    .from("runs")
    .select("id, status, icp, form, clarification_rounds, target_leads")
    .eq("id", id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  if (!isRunStatus(run.status)) {
    return NextResponse.json(
      { error: `This run is in an unrecognised state (${run.status}).` },
      { status: 409 },
    );
  }

  const status: RunStatus = run.status;

  // THE check. Same table, same status field, as the UI.
  if (!actionAllowed(status, actionId)) {
    return NextResponse.json(
      {
        error: `That can't be done while the run is "${status.replace(/_/g, " ")}". Refresh to see the current options.`,
      },
      { status: 409 },
    );
  }

  const body: unknown = await request.json().catch(() => ({}));
  const db = serviceClient();

  switch (actionId) {
    // -----------------------------------------------------------------------
    case "cancel": {
      const { data } = await db
        .from("runs")
        .update({ status: "cancelled", stopping_reason: "Cancelled by you." })
        .eq("id", id)
        .eq("status", status) // conditional: only if it is still what we read
        .select("id")
        .maybeSingle();

      if (!data) return conflict();
      await event(db, id, "status_change", "cancelled", "Cancelled by you.");
      return NextResponse.json({ ok: true });
    }

    // -----------------------------------------------------------------------
    case "stop_run": {
      // Stopping is not failing. The run keeps everything found so far and
      // lands in a state that has its own way forward.
      const { data } = await db
        .from("runs")
        .update({
          status: "completed_partial",
          stopping_reason: "You stopped the run. Everything found before that is kept below.",
        })
        .eq("id", id)
        .eq("status", "researching")
        .select("id")
        .maybeSingle();

      if (!data) return conflict();
      await event(db, id, "status_change", "completed_partial", "Stopped by you.");
      return NextResponse.json({ ok: true });
    }

    // -----------------------------------------------------------------------
    case "edit_icp": {
      const parsed = icpSchema.safeParse((body as { icp?: unknown })?.icp);
      if (!parsed.success) {
        return NextResponse.json(
          { error: `That ICP isn't valid: ${parsed.error.issues[0]?.message ?? "unknown problem"}` },
          { status: 400 },
        );
      }

      const { data } = await db
        .from("runs")
        .update({ icp: parsed.data, icp_finalized_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "icp_ready")
        .select("id")
        .maybeSingle();

      if (!data) return conflict();
      await event(db, id, "note", null, "ICP edited before research started.");
      return NextResponse.json({ ok: true });
    }

    // -----------------------------------------------------------------------
    case "start_research": {
      // Saved edits come with the request, so starting always uses the version
      // the user is actually looking at.
      const parsed = icpSchema.safeParse((body as { icp?: unknown })?.icp);
      if (parsed.success) {
        await db
          .from("runs")
          .update({ icp: parsed.data, icp_finalized_at: new Date().toISOString() })
          .eq("id", id)
          .eq("status", "icp_ready");
      }

      if (!run.icp && !parsed.success) {
        return NextResponse.json(
          { error: "This run has no finalised ICP yet, so research can't start." },
          { status: 409 },
        );
      }

      return handOffToAgent(id, "start");
    }

    // -----------------------------------------------------------------------
    case "retry":
    case "continue_higher_limit": {
      if (actionId === "continue_higher_limit") {
        await db.from("runs").update(RAISED_LIMITS).eq("id", id).eq("status", status);
        await event(
          db,
          id,
          "note",
          null,
          `Limits raised to ${RAISED_LIMITS.max_candidates} companies / ${RAISED_LIMITS.max_scrapes} website reads, continuing from where the run stopped.`,
        );
      }
      // The agent server's /retry resumes: companies already researched are
      // skipped, and cached scrapes are reused rather than re-paid for.
      return handOffToAgent(id, "retry");
    }

    // -----------------------------------------------------------------------
    case "start_over": {
      // Returns to the ICP screen so the user can change what's searched for.
      // It deliberately does NOT delete the candidates or leads already found —
      // a recovery action that destroys the only way forward is the bug this
      // whole section exists to avoid. Dedupe and the caches mean the kept work
      // is reused, not paid for twice.
      const { data } = await db
        .from("runs")
        .update({ status: "icp_ready", failure_reason: null, failed_step: null })
        .eq("id", id)
        .eq("status", status)
        .select("id")
        .maybeSingle();

      if (!data) return conflict();
      await event(
        db,
        id,
        "status_change",
        "icp_ready",
        "Started over. Companies already researched are kept and won't be paid for again.",
      );
      return NextResponse.json({ ok: true });
    }

    // -----------------------------------------------------------------------
    case "answer_clarification": {
      const answers = (body as { answers?: Record<string, string> })?.answers ?? {};

      if (run.clarification_rounds >= 3) {
        return NextResponse.json(
          {
            error:
              "That's the third round of questions. Rather than keep asking, edit the form directly and submit it again.",
          },
          { status: 409 },
        );
      }

      const { data } = await db
        .from("runs")
        .update({
          status: "refining",
          clarification_rounds: run.clarification_rounds + 1,
          form: { ...(run.form as object), clarifications: answers },
          pending_questions: null,
        })
        .eq("id", id)
        .eq("status", "awaiting_clarification")
        .select("id")
        .maybeSingle();

      if (!data) return conflict();
      await event(db, id, "status_change", "refining", "Answers received — re-checking the form.");

      // Phase 1 runs again with the answers appended. Deliberately a fresh
      // check rather than resuming a suspended session: a suspended loop dies
      // with the process, a fresh check does not.
      return NextResponse.json({ ok: true, recheck: true });
    }

    default:
      return NextResponse.json({ error: "Unhandled action." }, { status: 500 });
  }
}

function conflict() {
  return NextResponse.json(
    {
      error:
        "The run moved on before that went through — most likely another tab or a second click got there first. Refresh to see where it is now.",
    },
    { status: 409 },
  );
}

async function event(
  db: ReturnType<typeof serviceClient>,
  runId: string,
  kind: string,
  statusTo: string | null,
  reason: string,
) {
  await db.from("run_events").insert({
    run_id: runId,
    kind,
    status_to: statusTo,
    reason,
  });
}

/**
 * Hands the run to the agent server. The shared secret means nobody else can
 * trigger a run and spend the pooled Apify budget.
 */
async function handOffToAgent(runId: string, path: "start" | "retry") {
  const url = process.env.AGENT_SERVER_URL;
  const secret = process.env.AGENT_SHARED_SECRET;

  if (!url || !secret || secret.startsWith("REPLACE_ME")) {
    return NextResponse.json(
      {
        error:
          "The agent server isn't configured yet. Set AGENT_SERVER_URL and AGENT_SHARED_SECRET in web/.env.local, and start the agent server.",
      },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(`${url}/runs/${runId}/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 409) {
      return conflict();
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: `The agent server refused the request (${res.status}).` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    // The run has NOT been started, and its status has not been changed — so
    // the screen still offers the same action rather than stranding the user.
    return NextResponse.json(
      {
        error:
          "Couldn't reach the agent server. The run hasn't started and nothing was spent — check the server is running, then try again.",
      },
      { status: 503 },
    );
  }
}
