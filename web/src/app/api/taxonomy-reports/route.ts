import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceClient, requireUser } from "@/lib/supabase-server";
import { KNOWN_INDUSTRIES } from "@/lib/industries";
import { KNOWN_PLACES } from "@/lib/geography";

/**
 * Records a taxonomy rejection the user says the suggestions didn't fix — the
 * "log every rejected value" half of Decision #57.
 *
 * This is a REPORT, not a live edit. It writes one row and nothing else reads
 * or acts on it automatically: industries.ts and geography.ts stay static,
 * checked-in, hand-reviewed files. A report here is a data point for whoever
 * next reviews the taxonomy, never an instruction the app follows on its own
 * — the same reasoning as every other guard in this project that keeps a
 * consequential decision in reviewed code rather than in runtime state one
 * user's input can reach.
 */

const bodySchema = z.object({
  field: z.enum(["industry", "geography"]),
  rawInput: z.string().trim().min(1).max(200),
  // The suggestions the user was actually shown. Required and non-empty:
  // this flow only exists when the code had something to suggest, not for
  // plain gibberish with nothing to react to — the caller enforces that by
  // simply never rendering the flag affordance when suggestions are empty,
  // and this check is the server-side backstop for a direct API call that
  // skips the UI.
  suggestionsShown: z.array(z.string().trim().min(1)).min(1).max(10),
  // Which suggestion the user says was right, or null for "none of these".
  chosenLabel: z.string().trim().min(1).max(200).nullable(),
  // What the user actually meant, when none of the suggestions were it.
  // Deliberately NOT checked against the taxonomy — that's the whole point
  // of this field existing. Optional even then: "none of these" with no
  // explanation is still a usable (if weaker) signal that the suggestions
  // missed, so this never blocks the report from being sent.
  userDescribedAs: z.string().trim().max(200).nullable().optional(),
});

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That report isn't valid." },
      { status: 400 },
    );
  }

  const { field, rawInput, suggestionsShown, chosenLabel, userDescribedAs } = parsed.data;

  // Every value here has to actually be a real taxonomy entry — a report
  // isn't a place to smuggle in arbitrary text either as a "suggestion" or a
  // "chosen" value, and validating against the real lists costs nothing.
  const knownList = field === "industry" ? KNOWN_INDUSTRIES : KNOWN_PLACES;
  const knownSet = new Set(knownList);

  if (!suggestionsShown.every((s) => knownSet.has(s))) {
    return NextResponse.json(
      { error: "One of the suggestions isn't a real taxonomy entry." },
      { status: 400 },
    );
  }
  if (chosenLabel !== null && !knownSet.has(chosenLabel)) {
    return NextResponse.json(
      { error: "The chosen label isn't a real taxonomy entry." },
      { status: 400 },
    );
  }

  const db = serviceClient();
  const { error } = await db.from("taxonomy_reports").insert({
    user_id: user.id,
    field,
    raw_input: rawInput,
    suggestions_shown: suggestionsShown,
    chosen_label: chosenLabel,
    user_described_as: userDescribedAs || null,
  });

  if (error) {
    return NextResponse.json({ error: "Couldn't save that report." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
