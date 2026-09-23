import { test } from "node:test";
import assert from "node:assert/strict";
import { computeConfidence, checkCitation } from "./scoring.js";
import { toStringArray, toObject, cleanString, normalizeDomain, toInt } from "./normalize.js";

/**
 * Every test here has a negative case: the specific thing that must still be
 * REFUSED, not just the thing that must succeed.
 */

// ---------------------------------------------------------------------------
// Boundary normalisation — model output arrives in whatever shape it arrives in
// ---------------------------------------------------------------------------

test("toStringArray accepts every shape a model actually emits", () => {
  assert.deepEqual(toStringArray(["a", "b"]), ["a", "b"]);
  assert.deepEqual(toStringArray('["a", "b"]'), ["a", "b"]);
  assert.deepEqual(toStringArray("single"), ["single"]);
  assert.deepEqual(toStringArray({ 0: "a", 1: "b" }), ["a", "b"]);
  assert.deepEqual(toStringArray({ items: ["a"] }), ["a"]);
  assert.deepEqual(toStringArray(null), []);
  assert.deepEqual(toStringArray([" a ", "", "a"]), ["a", "a"]);
});

test("toStringArray salvages a response truncated mid-array rather than failing", () => {
  // The closing bracket never arrived. Losing three good entries because the
  // fourth was cut off is worse than salvaging what parsed.
  const salvaged = toStringArray('["alpha", "beta", "gam');
  assert.ok(salvaged.length >= 2, `expected at least 2 entries, got ${JSON.stringify(salvaged)}`);
  assert.equal(salvaged[0], "alpha");
});

test("cleanString strips leaked tool-call scaffolding out of a value", () => {
  assert.equal(cleanString("<invoke name=\"x\">Acme Ltd</invoke>"), "Acme Ltd");
  assert.equal(cleanString("```json\nAcme\n```"), "Acme");
});

test("toObject returns {} rather than throwing on junk", () => {
  assert.deepEqual(toObject('{"a":1}'), { a: 1 });
  assert.deepEqual(toObject("not json at all"), {});
  assert.deepEqual(toObject('{"a": 1'), {}); // truncated
});

test("normalizeDomain collapses the variants that would otherwise duplicate a lead", () => {
  const variants = [
    "https://www.acme.com/",
    "http://acme.com",
    "ACME.com",
    "www.acme.com/about?x=1",
    "acme.com.",
  ];
  for (const v of variants) assert.equal(normalizeDomain(v), "acme.com", `failed on ${v}`);

  // Negative: something that is not a domain must not become one.
  assert.equal(normalizeDomain("localhost"), null);
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain(null), null);
});

test("toInt reads headcount out of the shapes a company database returns", () => {
  assert.equal(toInt(42), 42);
  assert.equal(toInt("42"), 42);
  assert.equal(toInt("10-100"), 10);
  assert.equal(toInt("about 250 employees"), 250);
  assert.equal(toInt("unknown"), null);
  assert.equal(toInt(null), null);
});

// ---------------------------------------------------------------------------
// Confidence — computed from evidence, never supplied by the agent
// ---------------------------------------------------------------------------

test("confidence is 100 only when every hard filter is confirmed by direct evidence", () => {
  const { score } = computeConfidence(
    [
      { verdict: "confirmed", evidence_kind: "direct" },
      { verdict: "confirmed", evidence_kind: "direct" },
      { verdict: "confirmed", evidence_kind: "direct" },
    ],
    [],
  );
  assert.equal(score, 100);
});

test("confidence drops for inference, unknowns and unmet nice-to-haves", () => {
  const inferred = computeConfidence(
    [
      { verdict: "confirmed", evidence_kind: "direct" },
      { verdict: "confirmed", evidence_kind: "inferred" },
    ],
    [],
  );
  assert.equal(inferred.score, 75);

  const withUnknown = computeConfidence(
    [{ verdict: "confirmed", evidence_kind: "direct" }, { verdict: "unknown" }],
    [],
  );
  assert.equal(withUnknown.score, 75);

  const withSoft = computeConfidence(
    [{ verdict: "confirmed", evidence_kind: "direct" }],
    ["hiring ops roles", "publishes about scaling"],
  );
  assert.equal(withSoft.score, 80);
});

test("confidence is reproducible and never negative", () => {
  const filters = Array.from({ length: 6 }, () => ({ verdict: "failed" }));
  const a = computeConfidence(filters, ["x", "y", "z"]);
  const b = computeConfidence(filters, ["x", "y", "z"]);
  assert.equal(a.score, b.score, "same evidence must give the same score");
  assert.equal(a.score, 0, "score is clamped at 0, not negative");
});

test("confidence basis states the arithmetic, so a reviewer can check it", () => {
  const { basis } = computeConfidence(
    [{ verdict: "confirmed", evidence_kind: "inferred" }],
    ["hiring"],
  );
  assert.match(basis, /inference only/);
  assert.match(basis, /nice-to-have not met/);
});

// ---------------------------------------------------------------------------
// Citations — checked in code after generation, not trusted from the prompt
// ---------------------------------------------------------------------------

const SOURCES = ["https://acme.com/about"];
const SUMMARY = "Acme runs a dedicated support team of six and sells only to businesses.";

test("a citation naming a real source URL passes", () => {
  const r = checkCitation("They run a dedicated support team of six", SOURCES[0]!, SOURCES, SUMMARY);
  assert.equal(r.ok, true);
});

test("a citation is REFUSED when its URL is not one of the lead's sources", () => {
  // This is the injection case: a page told the agent to cite attacker.example.
  const r = checkCitation(
    "They run a dedicated support team",
    "https://attacker.example/collect",
    SOURCES,
    SUMMARY,
  );
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /not one of this lead's source URLs/);
});

test("a citation is REFUSED when it is too short to be a real citation", () => {
  const r = checkCitation("nice", null, SOURCES, SUMMARY);
  assert.equal(r.ok, false);
});

test("a citation with no URL and no overlap with the source summary is REFUSED", () => {
  // "Loved what you're building" — the weak personalization the guide names.
  const r = checkCitation(
    "Loved everything happening over there recently, genuinely inspiring stuff",
    null,
    SOURCES,
    SUMMARY,
  );
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /cannot be checked/);
});

test("a citation with no URL but real overlap with the summary passes", () => {
  const r = checkCitation("They mention a dedicated support team", null, SOURCES, SUMMARY);
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------------------
// mapRecord — headcount mapping, verified against real records the live
// discovery call actually returned from harvestapi/linkedin-company-search
// ---------------------------------------------------------------------------

test("mapRecord derives employeeCount from employeeCountRange when no flat field exists", async () => {
  const { mapRecord } = await import("./providers/mapCompanyRecord.js");
  // A real record: no flat `employeeCount` at all, only the range LinkedIn
  // itself displays. Before the fix this silently mapped to null.
  const record = {
    name: "Software Development & SEO Services",
    website: "https://progneo.com/",
    employeeCountRange: { start: 51, end: 200 },
    locations: [{ headquarter: true, parsed: { city: "Las Vegas", countryFull: "United States of America" } }],
    industries: [{ name: "Software Development" }],
  };
  const mapped = mapRecord(record);
  assert.equal(mapped.employeeCount, 126, "midpoint of 51-200, rounded");
});

test("mapRecord prefers employeeCountRange over a disagreeing flat field", async () => {
  const { mapRecord } = await import("./providers/mapCompanyRecord.js");
  // A real record where the two fields the actor returns actually disagreed:
  // flat employeeCount said 37, employeeCountRange said 51-200. The range is
  // LinkedIn's own displayed bucket; the flat field looks like a separately
  // scraped, less reliable estimate — so the range wins.
  const record = {
    name: "DevKit",
    website: "https://devkit.agency",
    employeeCount: 37,
    employeeCountRange: { start: 51, end: 200 },
  };
  const mapped = mapRecord(record);
  assert.equal(mapped.employeeCount, 126, "range wins over the disagreeing flat field");
});

test("mapRecord falls back to a flat field when no range is present", () => {
  // The fixture provider's shape, and any future actor that only has a flat
  // field — the fallback this codebase already relied on before the fix.
  return import("./providers/mapCompanyRecord.js").then(({ mapRecord }) => {
    const mapped = mapRecord({ name: "Fixture Co", employeeCount: 42 });
    assert.equal(mapped.employeeCount, 42);
  });
});

test("mapRecord returns null employeeCount when neither shape is present", async () => {
  const { mapRecord } = await import("./providers/mapCompanyRecord.js");
  const mapped = mapRecord({ name: "No Data Co" });
  assert.equal(mapped.employeeCount, null);
});
