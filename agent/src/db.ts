import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/**
 * Service-role client. Bypasses RLS — this process is trusted, the browser is
 * not. Every guard that matters lives in the SECURITY DEFINER functions in
 * supabase/migrations/0002_guards.sql, not in the calls below.
 */
export const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Postgres raises our guard failures as exceptions with a `CODE: message`
 * shape. Turning them back into a stable code lets the tools report a precise
 * refusal to the agent, and lets tests assert on the exact guard that fired
 * rather than on prose.
 */
export class GuardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

const KNOWN_CODES = new Set([
  "RUN_NOT_CLAIMABLE",
  "RUN_NOT_RESEARCHING",
  "RUN_NOT_FOUND",
  "CANDIDATE_CAP_REACHED",
  "SCRAPE_CAP_REACHED",
  "TOOL_CALL_CAP_REACHED",
  "CANDIDATE_NOT_SCRAPEABLE",
  "CANDIDATE_NOT_IN_RUN",
  "NO_WEBSITE",
  "NO_FILTER_EVIDENCE",
  "STATUS_MISMATCH",
  "LEAD_NOT_FOUND",
  "LEAD_NOT_QUALIFIED",
  "REWRITE_UNAVAILABLE",
  "VERSION_NOT_FOUND",
  "INCOMPLETE_DRAFTS",
  "BAD_REQUEST",
  "CITATION_INVALID",
]);

export function asGuardError(err: unknown): GuardError {
  const message =
    typeof err === "object" && err && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  const code = message.split(":", 1)[0]?.trim() ?? "";
  return new GuardError(KNOWN_CODES.has(code) ? code : "UNKNOWN", message);
}

/** Calls a guard RPC, normalising a Postgres error into a GuardError. */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw asGuardError(error);
  return data as T;
}
