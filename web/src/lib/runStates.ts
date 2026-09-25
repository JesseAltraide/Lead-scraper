/**
 * THE run-states table, as code.
 *
 * This file is the single source of truth for "what stage are we in, and what
 * can be done about it". The screen renders its buttons from here, and every
 * API route authorises against the SAME map, keyed off the SAME status column
 * read fresh from the database.
 *
 * That is the whole point. A prior build had the backend correctly refusing an
 * action while the screen decided what to show from something else, so it kept
 * offering a button that could never work and the user was stuck. One table,
 * both sides, no second opinion.
 *
 * A status is not "built" until it has a row here. No state is a dead end:
 * every status below always yields at least one action.
 */

export const RUN_STATUSES = [
  "refining",
  "awaiting_clarification",
  "icp_ready",
  "researching",
  "completed",
  "completed_partial",
  "failed",
  "cancelled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export type RunActionId =
  | "cancel"
  | "answer_clarification"
  | "start_research"
  | "stop_run"
  | "retry"
  | "start_over"
  | "continue_higher_limit"
  | "review"
  | "start_new";

export type RunAction = {
  id: RunActionId;
  label: string;
  /** `primary` is the expected next step; `quiet` is a secondary way out. */
  tone: "primary" | "quiet" | "danger";
  /** POST target. `null` means it changes nothing on the server. */
  endpoint: string | null;
  /** Navigation instead of a state change. */
  href?: string;
  /** Shown on the button's confirm step, where one is warranted. */
  confirm?: string;
};

export type RunStateSpec = {
  /**
   * What the user is told is happening. Plain language — never the status code.
   * The raw status is a database value; it is not a thing to show people.
   */
  label: string;
  headline: string;
  detail: string;
  tone: "working" | "waiting" | "done" | "partial" | "error";
  live: boolean;
  actions: RunAction[];
};

/**
 * Facts about THIS run that decide whether an action is possible at all —
 * separate from its status. A run cancelled during the clarifying questions
 * never got an ICP, so "start over" (which returns to the ICP screen) has
 * nothing to return to.
 */
export type RunContext = {
  hasIcp: boolean;
  hasLeads: boolean;
  /**
   * How many times "Keep searching" has already raised this run's limits.
   * Part of the context for the same reason hasIcp is: the decision depends on
   * it, so leaving it out would just relocate the disagreement to whichever
   * side remembered to check it (see Errors & Fixes #4).
   */
  continuesUsed: number;
};

/** "Keep searching" may raise the limits at most this many times. */
export const MAX_CONTINUES = 3;

const CANCEL: RunAction = {
  id: "cancel",
  label: "Cancel",
  tone: "quiet",
  endpoint: "cancel",
  confirm: "Cancel this run? Anything already found is kept and stays reviewable.",
};

const START_OVER: RunAction = {
  id: "start_over",
  // Not "Change what we search for" — icp_ready is view-only (Decision #61),
  // so this genuinely cannot change anything any more. It goes back to the
  // confirm screen to review the same criteria before resuming, which is a
  // real, different, non-misleading purpose: a second look before spending
  // more, not an edit. Getting different criteria requires a new search.
  label: "Review and continue",
  tone: "quiet",
  endpoint: "start-over",
  confirm:
    "This takes you back to the same criteria to review before continuing. The companies already researched are kept and won't be paid for again.",
};

const START_NEW: RunAction = {
  id: "start_new",
  label: "Start a new search",
  tone: "primary",
  endpoint: null,
  href: "/",
};

const REVIEW: RunAction = {
  id: "review",
  label: "See the leads",
  tone: "primary",
  endpoint: null,
};

export const RUN_STATES: Record<RunStatus, RunStateSpec> = {
  refining: {
    label: "Checking your answers",
    headline: "Checking your answers",
    detail:
      "Looking for anything too vague to search, anything that contradicts itself, and any requirement no website could confirm.",
    tone: "working",
    live: true,
    actions: [CANCEL],
  },

  awaiting_clarification: {
    label: "Needs your answer",
    headline: "A few questions before we search",
    detail:
      "Each question is about one answer you gave. Answering costs nothing — getting this right now is what stops a paid search being spent on a guess.",
    tone: "waiting",
    live: false,
    actions: [
      { id: "answer_clarification", label: "Send answers", tone: "primary", endpoint: "clarify" },
      CANCEL,
    ],
  },

  icp_ready: {
    label: "Ready to start",
    headline: "Check what we'll search for",
    // View-only by design (per PRD.md, which is silent on editing here — see
    // Decision #61): every field arriving at this screen has already passed
    // the same validation the intake form enforces (industry taxonomy,
    // persona vagueness/gibberish, size band, gibberish-free text on every
    // free-text field), so there is no case where in-place editing was
    // needed to fix an invalid value reaching here. Getting something
    // different means starting over, not patching this screen.
    detail:
      "This is exactly what you answered, already checked and ready to search. Nothing has been spent yet.",
    tone: "waiting",
    live: false,
    actions: [
      { id: "start_research", label: "Start searching", tone: "primary", endpoint: "start" },
      CANCEL,
    ],
  },

  researching: {
    label: "Searching now",
    headline: "Searching",
    detail:
      "Companies appear below as they're found. Each one is checked against your requirements before its website is read, so nothing is spent on a company that clearly doesn't fit.",
    tone: "working",
    live: true,
    actions: [
      {
        id: "stop_run",
        label: "Stop",
        tone: "danger",
        endpoint: "stop",
        confirm: "Stop here? Everything found so far is kept, and you can carry on later.",
      },
    ],
  },

  completed: {
    label: "Finished",
    headline: "Finished",
    detail:
      "You have the leads you asked for. Anything that couldn't be fully checked is listed separately and wasn't counted.",
    tone: "done",
    live: false,
    actions: [REVIEW, START_NEW],
  },

  completed_partial: {
    label: "Finished early",
    headline: "Finished with fewer leads than you asked for",
    detail:
      "A limit was reached first. The list wasn't padded out with weak leads to hit the number — the reason is below.",
    tone: "partial",
    live: false,
    actions: [
      REVIEW,
      // Plain resume, no limit change — for the common case of a MANUAL
      // stop (plenty of budget left, the user just wants to pick back up).
      // Reuses the exact same "retry" endpoint/action `failed` already uses:
      // the agent's own /retry handler already accepts completed_partial,
      // and this route's "retry" case already skips the limit-raising logic
      // that only "continue_higher_limit" triggers — nothing new to wire up.
      {
        id: "retry",
        label: "Continue from where it stopped",
        tone: "primary",
        endpoint: "retry",
      },
      // Distinct from the above: this one RAISES the limits, for when the
      // run stopped because it genuinely ran out of budget, not because the
      // user chose to pause it.
      {
        id: "continue_higher_limit",
        label: "Keep searching",
        tone: "quiet",
        endpoint: "continue",
        confirm:
          "This raises the limits and carries on from where it stopped. Companies already researched won't be paid for again.",
      },
      START_NEW,
    ],
  },

  failed: {
    label: "Stopped on a problem",
    headline: "The search stopped on a problem",
    detail:
      "What went wrong is below. Trying again picks up where it stopped — the companies already researched aren't redone or paid for twice.",
    tone: "error",
    live: false,
    actions: [
      { id: "retry", label: "Try again from where it stopped", tone: "primary", endpoint: "retry" },
      START_OVER,
      REVIEW,
    ],
  },

  cancelled: {
    label: "Cancelled",
    headline: "Cancelled",
    detail: "Anything found before you cancelled is kept below.",
    tone: "done",
    live: false,
    actions: [REVIEW, START_OVER],
  },
};

/**
 * The actions genuinely available for a run, given its status AND its contents.
 *
 * Status alone is not enough. A run cancelled during the clarifying questions
 * has no ICP, so every action that needs one is impossible no matter what its
 * status says — and offering it would produce a button the backend must refuse.
 * That is the exact bug this file exists to prevent, so the filtering happens
 * HERE, in the one place both the screen and the API routes consult.
 */
export function actionsFor(status: RunStatus, ctx: RunContext): RunAction[] {
  const needsIcp: RunActionId[] = [
    "start_research",
    "retry",
    "continue_higher_limit",
    "start_over", // returns to the ICP screen, so it needs an ICP to return to
  ];

  let actions = RUN_STATES[status].actions.filter((a) => {
    if (!ctx.hasIcp && needsIcp.includes(a.id)) return false;
    if (a.id === "review" && !ctx.hasLeads) return false;
    // Raising the limits is capped. Filtered out here rather than disabled in
    // the screen, so the button and the backend agree without either needing
    // to know about the other.
    if (a.id === "continue_higher_limit" && ctx.continuesUsed >= MAX_CONTINUES) return false;
    return true;
  });

  // The button said "Keep searching" every time, with no way to tell how many
  // raises were left or that a given press was the last one — the run just
  // stopped offering it afterward with no explanation. Real user confusion
  // this caused: watching the cap climb (30 -> 35 -> 40 -> 45) with no visible
  // ceiling looked like the limit itself was drifting, when MAX_CONTINUES
  // already fixed it at a hard, known maximum the whole time.
  actions = actions.map((a) =>
    a.id === "continue_higher_limit"
      ? { ...a, label: `${a.label} (${ctx.continuesUsed + 1} of ${MAX_CONTINUES})` }
      : a,
  );

  // No state is a dead end. If filtering left nothing to do, starting a fresh
  // search is always available.
  const terminal: RunStatus[] = ["completed", "completed_partial", "failed", "cancelled"];
  if (actions.length === 0 || (terminal.includes(status) && !actions.some((a) => a.id === "start_new"))) {
    actions = [...actions, START_NEW];
  }

  return actions;
}

/**
 * The authorisation check. The screen calls it to decide what to render; every
 * API route calls it to decide what to permit, with the same context built from
 * the same row. They cannot disagree, because it is the same function.
 */
export function actionAllowed(status: RunStatus, actionId: RunActionId, ctx: RunContext): boolean {
  return actionsFor(status, ctx).some((a) => a.id === actionId);
}

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && (RUN_STATUSES as readonly string[]).includes(value);
}

/** Statuses that count as an active run for the "one run at a time" rule. */
export const ACTIVE_STATUSES: RunStatus[] = [
  "refining",
  "awaiting_clarification",
  "icp_ready",
  "researching",
];
