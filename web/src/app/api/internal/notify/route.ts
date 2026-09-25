import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase-server";

/**
 * Milestone-email dispatch, moved here from the agent process on Render.
 *
 * Render's outbound network could not reach smtp.gmail.com at all (confirmed
 * via Render's own logs: ETIMEDOUT on port 587, then ENETUNREACH trying an
 * IPv6 address — a network-level failure, not a credentials problem, since
 * this exact SMTP_USER/SMTP_PASS pair sent a real test email successfully
 * from a local machine). Vercel's network has no reason to share that
 * restriction, so the actual SMTP send happens here instead.
 *
 * The TRIGGER stays on the agent side (runAgent.ts / tools.ts) deliberately —
 * it fires unconditionally as part of the run's own lifecycle, never
 * depending on a browser tab being open. Moving the trigger itself to a
 * web-side poll would have quietly broken the entire point of a
 * notification: "email me when it's done" only means something if it does
 * not depend on someone already watching. Only the SMTP call moves; this
 * route is just where that call now happens, reached over the same HTTPS
 * connection the agent already uses to reach the web app, which is
 * unrestricted the way raw SMTP ports on Render evidently are not.
 */

function authorized(header: string | null): boolean {
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!header || !secret || secret.startsWith("REPLACE_ME")) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const bodySchema = z.object({
  runId: z.string().uuid(),
  marker: z.string().min(1),
  subject: z.string().min(1),
  text: z.string().min(1),
});

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass || user.startsWith("REPLACE_ME") || pass.startsWith("REPLACE_ME")) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
  }
  return transporter;
}

/**
 * Both milestones are one-shot per run — ported unchanged from the agent's
 * former notify.ts: a marker row in run_events, checked before sending and
 * written right after, so a tool the agent can legitimately call more than
 * once (check_list_quality, on a re-check) or a resumed run re-entering the
 * same path cannot send the same email twice.
 */
export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const { runId, marker, subject, text } = parsed.data;

  const t = getTransporter();
  if (!t) return NextResponse.json({ ok: false, skipped: "not configured" });

  const db = serviceClient();

  const { count } = await db
    .from("run_events")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("kind", "note")
    .eq("reason", marker);
  if ((count ?? 0) > 0) return NextResponse.json({ ok: false, skipped: "already sent" });

  const { data: run } = await db.from("runs").select("user_id").eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ ok: false, skipped: "run not found" });

  const { data: userData, error: userError } = await db.auth.admin.getUserById(run.user_id);
  if (userError || !userData.user?.email) {
    return NextResponse.json({ ok: false, skipped: "no recipient" });
  }

  try {
    await t.sendMail({ from: process.env.SMTP_USER!, to: userData.user.email, subject, text });
  } catch (err) {
    // A notification failing must never look like the run itself failed —
    // same fail-soft posture the agent's own version of this always had.
    console.error(`[notify] failed to send for run ${runId}:`, err);
    return NextResponse.json({ ok: false, error: "send failed" }, { status: 502 });
  }

  // Written AFTER a successful send, as the marker itself — if sending threw,
  // nothing is recorded, and a later retry from the agent can send it for real.
  await db.from("run_events").insert({ run_id: runId, kind: "note", reason: marker });
  return NextResponse.json({ ok: true });
}
