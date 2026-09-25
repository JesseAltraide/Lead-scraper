/**
 * Splits an agent-written explanation into a short plain-language headline
 * plus the full technical detail, so the screen can show the short version
 * up front and keep the rest available without hiding it.
 *
 * The agent (finish_run's stopping_reason, fail_run's failure_reason) writes
 * for a technical reviewer: precise, but often several sentences of budget
 * counts and tool-call reasoning. A user opening the run page wants "what
 * happened" in one line, not a debugging transcript, so this splits on the
 * first sentence and treats everything after it as the technical log.
 */
export function splitSummary(text: string): { headline: string; technical: string | null } {
  const trimmed = text.trim();
  // (?<!\d) skips a decimal point like "3.5" (that "." is preceded by a
  // digit). The lookahead then requires the punctuation to be followed by
  // whitespace-plus-capital-letter or the end of the string, so an
  // abbreviation like "e.g." (followed by a lowercase letter) doesn't count
  // as a sentence end either. Both are real cases the agent's own reasons hit
  // often (budget counts, "e.g." asides).
  const match = trimmed.match(/^(.+?(?<!\d)[.!?])(?=\s+[A-Z]|\s*$)/);
  if (!match) return { headline: trimmed, technical: null };

  const headline = match[1];
  const rest = trimmed.slice(match[0].length).trim();
  return { headline, technical: rest.length > 0 ? rest : null };
}
