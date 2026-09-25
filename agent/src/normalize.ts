/**
 * Normalise at the boundary.
 *
 * Any field coming back from the model can arrive as a JSON string, a keyed
 * object, an array, or truncated mid-object — and tool-call scaffolding can
 * leak into string values. One helper per expected shape, applied on the way
 * in, so the rest of the code only ever sees the clean form.
 */

/** Strips leaked tool-call tags and formatting artifacts from a string value. */
export function cleanString(input: unknown): string {
  if (input == null) return "";
  let s = typeof input === "string" ? input : String(input);

  // Model scaffolding that has leaked into a value rather than wrapping it.
  s = s.replace(/<\/?(?:antml:)?(?:invoke|parameter|function_calls|thinking)[^>]*>/gi, "");
  s = s.replace(/^```(?:json|markdown|text)?\s*/i, "").replace(/```\s*$/, "");

  // No em dashes anywhere the model writes text. " — " (a parenthetical
  // aside, spaced both sides) reads naturally as a comma; a bare "—" joining
  // two words with no surrounding space reads naturally as a hyphen.
  s = s.replace(/\s+—\s+/g, ", ").replace(/—/g, " - ");

  return s.trim();
}

/**
 * Accepts: a real array, a JSON-encoded array, a single string, a keyed object
 * ({"0": "a", "1": "b"} or {items: [...]}), or null. Returns a clean string[].
 */
export function toStringArray(input: unknown): string[] {
  if (input == null) return [];

  if (typeof input === "string") {
    const s = cleanString(input);
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        return toStringArray(JSON.parse(s));
      } catch {
        // Truncated mid-object: salvage the complete entries rather than failing.
        return s
          .replace(/^\[|\]$/g, "")
          .split(/",\s*"/)
          .map((p) => cleanString(p.replace(/^"|"$/g, "")))
          .filter(Boolean);
      }
    }
    return [s];
  }

  if (Array.isArray(input)) {
    return input.map(cleanString).filter(Boolean);
  }

  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.items)) return toStringArray(obj.items);
    return Object.values(obj).map(cleanString).filter(Boolean);
  }

  return [cleanString(input)].filter(Boolean);
}

/** Accepts a real object or a JSON-encoded one. Returns {} rather than throwing. */
export function toObject(input: unknown): Record<string, unknown> {
  if (input == null) return {};
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string") {
    const s = cleanString(input);
    if (!s.startsWith("{")) return {};
    try {
      const parsed: unknown = JSON.parse(s);
      return typeof parsed === "object" && parsed && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Accepts a number, a numeric string, or "10-100" style ranges (takes the low end). */
export function toInt(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return Math.trunc(input);
  if (typeof input !== "string") return null;
  const m = cleanString(input).match(/-?\d+/);
  return m ? Number.parseInt(m[0], 10) : null;
}

/** Strip protocol, `www.`, path and trailing dot; lowercase. Mirrors web/src/lib/icp.ts. */
export function normalizeDomain(input: unknown): string | null {
  const raw = cleanString(input).toLowerCase();
  if (!raw) return null;
  let d = raw.replace(/^[a-z]+:\/\//, "");
  d = d.split("/")[0] ?? "";
  d = d.split("?")[0] ?? "";
  d = d.replace(/^www\./, "").replace(/\.$/, "");
  return d.includes(".") ? d : null;
}

/** Truncates for the tool-call log's summary columns without losing the shape. */
export function summarize(value: unknown, max = 500): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  s = s ?? "";
  return s.length <= max ? s : `${s.slice(0, max)}… (${s.length} chars)`;
}
