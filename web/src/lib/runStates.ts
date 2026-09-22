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
 * every status below has at least one action, or is genuinely terminal with a
 * way to start something new.
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
  | "edit_icp"
  | "start_research"
  | "stop_run"
  | "retry"
  | "start_over"
  | "continue_higher_limit"
  | "review";

export type RunAction = {
  id: RunActionId;
  label: string;
  /** `primary` is the expected next step; `quiet` is a secondary way out. */
  tone: "primary" | "quiet" | "danger";
  /** POST target. `null` means it is navigation within the app, not a state change. */
  endpoint: string | null;
  /** Shown on the button's confirm step, where one is warranted. */
  confirm?: string;
};

export type RunStateSpec = {
  /** What the user is told is happening. Plain language, no status codes. */
  headline: string;
  /** One line of detail underneath. */
  detail: string;
  tone: "working" | "waiting" | "done" | "partial" | "error";
  /** True when the screen should keep polling for changes. */
  live: boolean;
  actions: RunAction[];
};

const CANCEL: RunAction = {
  id: "cancel",
  label: "Cancel",
  tone: "quiet",
  endpoint: "cancel",
  confirm: "Cancel this run? Anything already found is kept and stays reviewable.",
};

const START_OVER: RunAction = {
  id: "start_over",
  label: "Start over",
  tone: "quiet",
  endpoint: "start-over",
  confirm:
    "Start over returns to the ICP screen so you can change it. The companies already researched are kept and will not be paid for again.",
};

const REVIEW: RunAction = {
  id: "review",
  label: "Review leads",
  tone: "primary",
  endpoint: null,
};

export const RUN_STATES: Record<RunStatus, RunStateSpec> = {
  refining: {
    headline: "Checking your form",
    detail:
      "Looking for anything too vague to search, anything contradictory, and any requirement no website could confirm.",
    tone: "working",
    live: true,
    actions: [CANCEL],
  },

  awaiting_clarification: {
    headline: "A few questions before we search",
    detail:
      "Each question points at one field. Answering them costs nothing — getting this right before discovery is what stops paid searches being spent on a guess.",
    tone: "waiting",
    live: false,
    actions: [
      { id: "answer_clarification", label: "Send answers", tone: "primary", endpoint: "clarify" },
      CANCEL,
    ],
  },

  icp_ready: {
    headline: "Confirm what we'll search for",
    detail:
      "This is the version the agent will actually use, not the version you originally typed. Edit anything that looks wrong — research has not started and nothing has been spent.",
    tone: "waiting",
    live: false,
    actions: [
      { id: "start_research", label: "Start research", tone: "primary", endpoint: "start" },
      { id: "edit_icp", label: "Save changes", tone: "quiet", endpoint: "icp" },
      CANCEL,
    ],
  },

  researching: {
    headline: "Researching",
    detail:
      "Companies appear below as they're found. Each is screened on search data before any website is read, so no credit is spent on a clear misfit.",
    tone: "working",
    live: true,
    actions: [
      {
        id: "stop_run",
        label: "Stop run",
        tone: "danger",
        endpoint: "stop",
        confirm:
          "Stop the run here? Everything found so far is kept and reviewable, and you can continue later.",
      },
    ],
  },

  completed: {
    headline: "Done",
    detail:
      "The target was reached. Leads needing review are listed separately and are not counted toward it.",
    tone: "done",
    live: false,
    actions: [REVIEW],
  },

  completed_partial: {
    headline: "Finished with fewer leads than the target",
    detail:
      "A limit was reached first. The list was not padded to hit the number — the reason is stated below.",
    tone: "partial",
    live: false,
    actions: [
      REVIEW,
      {
        id: "continue_higher_limit",
        label: "Continue with higher limits",
        tone: "quiet",
        endpoint: "continue",
        confirm:
          "This raises the run's limits and continues from where it stopped. Companies already researched are not paid for again.",
      },
    ],
  },

  failed: {
    headline: "The run stopped on an error",
    detail:
      "The step that failed and why are shown below. Retrying picks up from where it stopped — the companies already researched are not redone or paid for twice.",
    tone: "error",
    live: false,
    actions: [
      { id: "retry", label: "Retry from where it stopped", tone: "primary", endpoint: "retry" },
      START_OVER,
      REVIEW,
    ],
  },

  cancelled: {
    headline: "Cancelled",
    detail: "What had been found before cancelling is kept below.",
    tone: "done",
    live: false,
    actions: [REVIEW, START_OVER],
  },
};

/**
 * The authorisation check. Both the screen (to decide what to render) and every
 * API route (to decide what to permit) call this with the status read from the
 * database. If this returns false, the button is not rendered AND the request
 * is refused — they cannot disagree, because it is the same function.
 */
export function actionAllowed(status: RunStatus, actionId: RunActionId): boolean {
  return RUN_STATES[status].actions.some((a) => a.id === actionId);
}

export function actionsFor(status: RunStatus): RunAction[] {
  return RUN_STATES[status].actions;
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
