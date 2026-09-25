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
 * The actual SMTP send happens on the WEB app now (web/src/app/api/internal/
 * notify/route.ts), not here — Render's outbound network could not reach
 * Gmail's SMTP servers at all (confirmed via Render's own logs: ETIMEDOUT,
 * then ENETUNREACH on an IPv6 address, before ever reaching authentication).
 * This function's job is only to decide WHEN to notify — that trigger stays
 * here, tied to the run's own lifecycle, never to whether anyone has a
 * browser tab open — and to hand the actual dispatch to web over the same
 * HTTPS connection the agent already uses to reach it.
 *
 * Fails soft, always: a milestone email is a courtesy, not a guarantee the
 * product depends on. A run must never fail, stall, or even log at error
 * level because the web app was unreachable or WEB_APP_URL was never set.
 */

async function send(runId: string, marker: string, subject: string, text: string): Promise<void> {
  if (!env.webAppUrl) return; // not configured — silently skip, same posture as fixture mode

  try {
    const res = await fetch(`${env.webAppUrl}/api/internal/notify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.sharedSecret}` },
      body: JSON.stringify({ runId, marker, subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[notify] web app refused the send for run ${runId}: ${res.status}`);
    }
  } catch (err) {
    // A notification failing is never allowed to fail the run it describes.
    console.error(`[notify] failed to reach web app for run ${runId}:`, err);
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
