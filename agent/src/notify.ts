import nodemailer from "nodemailer";
import { db } from "./db.js";
import { env } from "./env.js";

/**
 * Milestone emails: "drafts ready" and "search finished". Two real, distinct
 * events, not one signal split in two — full-flow.md's pipeline has no status
 * change between Phase 5 (drafting) and Phase 6 (list quality) and finishing,
 * so "drafts ready" is anchored to check_list_quality itself: the one tool
 * that only ever runs after every qualified lead already has all four draft
 * pieces. "Search finished" is anchored to the run actually leaving
 * `researching` — completed, completed_partial, or failed.
 *
 * Fails soft, always: a milestone email is a courtesy, not a guarantee the
 * product depends on. A run must never fail, stall, or even log at error
 * level because Gmail was unreachable or SMTP_USER was never set.
 */

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!env.smtpUser || !env.smtpPass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });
  }
  return transporter;
}

async function recipientFor(runId: string): Promise<string | null> {
  const { data: run } = await db.from("runs").select("user_id").eq("id", runId).maybeSingle();
  if (!run) return null;
  const { data, error } = await db.auth.admin.getUserById(run.user_id);
  if (error || !data.user?.email) return null;
  return data.user.email;
}

/**
 * Both milestones are one-shot per run: this checks run_events for a marker
 * of the same kind before sending, and writes one right after — so a tool the
 * agent can legitimately call more than once (check_list_quality, if it
 * re-checks after finding an issue) or a resumed run re-entering the same
 * code path cannot send the same email twice.
 */
async function alreadySent(runId: string, marker: string): Promise<boolean> {
  const { count } = await db
    .from("run_events")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("kind", "note")
    .eq("reason", marker);
  return (count ?? 0) > 0;
}

async function send(runId: string, marker: string, subject: string, text: string): Promise<void> {
  try {
    const t = getTransporter();
    if (!t) return; // not configured — silently skip, same posture as fixture mode

    if (await alreadySent(runId, marker)) return;

    const to = await recipientFor(runId);
    if (!to) return;

    await t.sendMail({ from: env.smtpUser!, to, subject, text });

    // Written AFTER a successful send, as the marker itself — if sending
    // throws, nothing is recorded and a later retry can send it for real.
    await db.from("run_events").insert({ run_id: runId, kind: "note", reason: marker });
  } catch (err) {
    // A notification failing is never allowed to fail the run it describes.
    console.error(`[notify] failed to send for run ${runId}:`, err);
  }
}

export async function notifyDraftsReady(runId: string): Promise<void> {
  await send(
    runId,
    "milestone: drafts_ready",
    "Your outreach drafts are ready to review",
    `Your search has finished writing outreach drafts for its qualified leads.\n\nReview them at your run's page in the app.\n\nRun: ${runId}`,
  );
}

export async function notifySearchFinished(runId: string, outcome: string): Promise<void> {
  await send(
    runId,
    "milestone: search_finished",
    "Your search has finished",
    `Your search finished with status: ${outcome}.\n\nOpen the run in the app to see what it found.\n\nRun: ${runId}`,
  );
}
