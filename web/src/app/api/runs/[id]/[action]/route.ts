import { NextResponse } from "next/server";
import { serverClient, serviceClient, requireUser } from "@/lib/supabase-server";
import {
  actionAllowed,
  isRunStatus,
  RUN_STATES,
  MAX_CONTINUES,
  type RunActionId,
  type RunStatus,
} from "@/lib/runStates";
import { intakeFormSchema } from "@/lib/icp";
import {
  runClarityCheck,
  blockerResolved,
  type ClarificationItem,
} from "@/lib/clarityCheck";

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
  start: "start_research",
  stop: "stop_run",
  retry: "retry",
  "start-over": "start_over",
  continue: "continue_higher_limit",
};

const BREAK = String.fromCharCode(10);

/**
 * What each "Keep searching" adds to the run's CURRENT limits — relative
 * increments, not an absolute table.
 *
 * This was first a single flat constant (30/20 every time, meaning presses 2
 * and 3 set the SAME numbers the run had already exhausted and did nothing),
 * then a hardcoded ladder of absolute numbers (35 -> 40 -> 45). The ladder
 * version broke the moment STARTING_LIMITS changed for testing: dropping the
 * starting max_candidates to 4 for a small test run meant the first press
 * jumped straight to 35 — an 8x jump, not the "+5 companies" the button
 * implies. A hardcoded absolute table can only ever be correct for the one
 * starting-limit value it was written against.
 *
 * Deriving the increment and adding it to whatever the run ACTUALLY started
 * with fixes that permanently: correct at 30/20, correct at 4/3, correct at
 * whatever STARTING_LIMITS is set to next.
 *
 * TODO(testing): STARTING_LIMITS in ../route.ts is temporarily set to
 * max_candidates: 4 / max_scrapes: 3 for low-volume testing. Restore it to
 * 30 / 20 once testing is done — nothing here needs to change when you do.
 *
 * Tool calls rise with them for the same reason the starting cap is derived
 * rather than round: each extra website read costs a scrape call, a
 * qualification call, and up to four draft calls if it qualifies.
 */
const CONTINUE_INCREMENT = { max_candidates: 5, max_scrapes: 3, max_tool_calls: 25, max_agent_turns: 20 };

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
    .select("id, status, icp, form, clarification_rounds, target_leads, pending_questions, continue_count, max_candidates, max_scrapes, max_tool_calls, max_agent_turns")
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

  // The same context the screen builds, from the same row — so the button the
  // user sees and the action the server permits are decided identically.
  const { count: leadCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("run_id", id);

  const ctx = {
    hasIcp: Boolean(run.icp),
    hasLeads: (leadCount ?? 0) > 0,
    continuesUsed: run.continue_count ?? 0,
  };

  // THE check. Same table, same status field, same context, as the UI.
  if (!actionAllowed(status, actionId, ctx)) {
    return NextResponse.json(
      {
        error: `That isn't possible right now (${RUN_STATES[status].label}). Refresh to see what you can do.`,
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
    case "start_research": {
      // icp_ready is view-only (Decision #61 — PRD.md doesn't specify editing
      // here, unlike week5-full-flow.md's original design). Deliberately does
      // NOT accept an `icp` override from the request body any more: every
      // value on `run.icp` already passed the same validation the intake
      // form enforces, so there is nothing here for a client to legitimately
      // improve on, and accepting one would let a direct API call edit the
      // ICP the UI no longer offers a way to edit.
      if (!run.icp) {
        return NextResponse.json(
          {
            error:
              "This run has no finalised criteria yet, so the search can't start. Start a new search — this one didn't get far enough to run.",
          },
          { status: 409 },
        );
      }

      return handOffToAgent(id, "start");
    }

    // -----------------------------------------------------------------------
    case "retry":
    case "continue_higher_limit": {
      if (actionId === "continue_higher_limit") {
        // Counted in the same write that raises the limits, conditional on the
        // count we authorised against — two overlapping clicks cannot both
        // spend a continue. Added to whatever the run's limits ACTUALLY are
        // right now, not looked up from a table keyed on how many times this
        // has been pressed — so it is correct regardless of what the run
        // started with.
        const raised = {
          max_candidates: run.max_candidates + CONTINUE_INCREMENT.max_candidates,
          max_scrapes: run.max_scrapes + CONTINUE_INCREMENT.max_scrapes,
          max_tool_calls: run.max_tool_calls + CONTINUE_INCREMENT.max_tool_calls,
          max_agent_turns: run.max_agent_turns + CONTINUE_INCREMENT.max_agent_turns,
        };

        const { data: bumped } = await db
          .from("runs")
          .update({ ...raised, continue_count: ctx.continuesUsed + 1 })
          .eq("id", id)
          .eq("status", status)
          .eq("continue_count", ctx.continuesUsed)
          .select("id")
          .maybeSingle();
        if (!bumped) return conflict();
        await event(
          db,
          id,
          "note",
          null,
          `Limits raised to ${raised.max_candidates} companies / ${raised.max_scrapes} website reads (raise ${ctx.continuesUsed + 1} of ${MAX_CONTINUES}), continuing from where the run stopped.`,
        );
      }
      // The agent server's /retry resumes: companies already researched are
      // skipped, and cached scrapes are reused rather than re-paid for.
      return handOffToAgent(id, "retry");
    }

    // -----------------------------------------------------------------------
    case "start_over": {
      // Returns to the icp_ready confirm screen for a second look at the same
      // criteria before resuming — NOT to change them, since that screen is
      // view-only (Decision #61). It deliberately does NOT delete the
      // candidates or leads already found — a recovery action that destroys
      // the only way forward is the bug this whole section exists to avoid.
      // Dedupe and the caches mean the kept work is reused, not paid for twice.
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
      const payload = body as {
        answers?: Record<string, string>;
        formEdits?: Record<string, unknown>;
      };
      const answers = payload.answers ?? {};
      const formEdits = payload.formEdits ?? {};

      const storedForm = (run.form ?? {}) as Record<string, unknown>;
      const findings = (run.pending_questions ?? []) as ClarificationItem[];
      const blockers = findings.filter((f) => f.kind === "blocker");

      const merged = { ...storedForm, ...formEdits };

      // THE enforcement. A contradiction cannot be explained away — one of the
      // conflicting fields must genuinely hold a different value now. Without
      // this check a blocker is only a strongly-worded question, and the user
      // can press on with a search that cannot possibly succeed.
      const unresolved = blockers.filter((b) => !blockerResolved(b, storedForm, merged));
      if (unresolved.length > 0) {
        return NextResponse.json(
          {
            error:
              unresolved.length === 1
                ? `Change one of these to continue: ${unresolved[0]!.fields.join(" or ")}. These answers can't both be true, so explaining won't make the search possible.`
                : `${unresolved.length} contradictions still need a field changed.`,
          },
          { status: 400 },
        );
      }

      // Free-text answers are context, so they go into the notes the agent
      // reads — not into a field they were never meant to overwrite.
      const extraNotes = Object.entries(answers)
        .map(([field, answer]) => `${field}: ${String(answer).trim()}`)
        .filter((line) => !line.endsWith(": "))
        .join(BREAK);

      const candidate = {
        ...merged,
        notes: [String(merged.notes ?? ""), extraNotes].filter(Boolean).join(BREAK).trim(),
      };

      const reparsed = intakeFormSchema.safeParse(candidate);
      if (!reparsed.success) {
        return NextResponse.json(
          {
            error: `That still isn't valid: ${reparsed.error.issues[0]?.message ?? "unknown problem"}`,
          },
          { status: 400 },
        );
      }

      // The 3-round cap itself is enforced in runClarityCheck, at the point a
      // 4th round would be CREATED — not here, at the point of answering one.
      // By the time a 4th-round submit could ever reach this handler the run
      // would already be `cancelled` (see clarityCheck.ts's
      // giveUpAfterMaxRounds), which the actionAllowed check above already
      // refuses with a clearer reason. Nothing reachable here needs a
      // separate round-count guard.

      const { data } = await db
        .from("runs")
        .update({
          status: "refining",
          clarification_rounds: run.clarification_rounds + 1,
          form: reparsed.data,
          pending_questions: null,
        })
        .eq("id", id)
        .eq("status", "awaiting_clarification")
        .select("id")
        .maybeSingle();

      if (!data) return conflict();
      await event(db, id, "status_change", "refining", "Answers received — re-checking.");

      // Actually re-run it. `refining` has no user action but cancel, so
      // leaving a run sitting there would be a dead end — which is exactly
      // what this did before: it set the status and nothing ever ran.
      await runClarityCheck(id, reparsed.data);

      return NextResponse.json({ ok: true });
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
        {
          error:
            `The agent server refused the request (${res.status}). Nothing was started and nothing was spent — ` +
            "refresh to see where the run actually is, then try again.",
        },
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
