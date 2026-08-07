import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ATTENDEE_COUNT,
  BENIGN_ADJACENT_PAIRS,
  BOUNDED_EXTENSIONS,
  CITY_HEALTH_AGENCY,
  COUNTED_PEOPLE,
  HISTORICAL_RECORDS,
  OPT_OUT_EXTENSIONS,
  OPT_OUT_MARKER,
  PROXIMITY,
  UNBOUNDED_RECORD_FILES,
  blocksOf,
  isParagraph,
  pairsAgencyWithCount,
  pinnedDigest,
  scanFile,
  stableRegisterRow,
} from "./spec-conflict-scan.mjs";

/**
 * The suite the DOHMH/headcount guard did not have.
 *
 * `vitest.config.ts` lines 27-29 states why it needs one: "a guard with no test proves only that
 * it does not false-positive on a good tree. Nothing proved it still FAILS on a bad one until its
 * suite existed." `spec-conflict-resolutions.test.mjs` runs its predicates over THIS repository,
 * where nothing is wrong, so a predicate that had quietly stopped catching anything would have
 * left that suite green. Three evasions shipped green that way and were found by hand in the
 * fourth PR #247 review round, not by CI.
 *
 * EVERY FIXTURE THAT STANDS FOR A REAL ARTIFACT IS BUILT FROM THAT ARTIFACT. Read this before
 * adding one, because it is the mistake this file made and certified:
 *
 * The fourth round's "flags the claim split across two adjacent register rows" fixture was two
 * hand-written table rows about 110 characters long. It passed. The real prettier-aligned register
 * rows in `docs/OPEN-QUESTIONS.md` are 4940 characters wide, and the cross-boundary pass was
 * bounded to 120 characters measured over the concatenated pair, so on the real artifact that pass
 * had never fired once: the fifth round instrumented it over every scanned root and counted 41
 * single-block flags and ZERO cross-boundary pairs. One fixture in this file was not
 * representative of the artifact it stood for, and it was the one that mattered. A miniature
 * cannot fail the way the real thing fails, and a fixture that cannot fail is not a test.
 *
 * So the structural fixtures below do not describe a register row, a bullet or a decision record.
 * They READ one out of the tree, plant the claim's two halves into it at their far ends, and
 * assert the dimension that hid the defect: that the two halves really are further apart than
 * `PROXIMITY`. If a future artifact stops having blocks of that size, the selection throws rather
 * than quietly shrinking back to a miniature.
 *
 * Where a fixture stands for the GUARD's own behaviour rather than for an artifact, it is still a
 * literal string, so it says what the guard does rather than what this tree happens to contain.
 *
 * Each of the defects the fourth and fifth rounds found has a case here that FAILED before its fix
 * and passes after, and each names the defect it stands for. The two knowingly-uncaught phrasings
 * are here too, as EXPECTED MISSES, asserted to be missed, so a later change that starts catching
 * one fails this suite and forces the disclosure in `spec-conflict-resolutions.test.mjs` to be
 * brought back into line. A disclosure that is only prose drifts; this is the part a test can hold.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");

const CLAIM = "DOHMH requires a temporary food-service permit";

/** The two halves the fifth PR #247 round planted, verbatim. */
const AGENCY_HALF = "DOHMH publishes the temporary food-service permit";
const COUNT_HALF = "it is driven by the F-101 headcount recorded at intake";

/**
 * The same claim in the ORDINARY-ENGLISH count vocabulary, which is the only half the distance
 * bound governs: `ATTENDEE_COUNT` ("headcount") is unbounded inside a block in every file kind.
 */
const COUNTED_HALF = "the assembly gate opens at 75 or more guests recorded at intake";

/**
 * The first adjacent pair of REAL blocks in `file` that are the requested shape, are at least
 * `minLength` characters long, and mention neither the agency nor a count.
 *
 * The length floor is the whole point: it is what a hand-written fixture silently fails to have.
 * The agency/count filter is so that planting a half into each block is unambiguous, and so that
 * the fixture is not accidentally testing something the artifact already says.
 */
function realAdjacentBlocks(file, { shape, minLength }) {
  const blocks = blocksOf(read(file)).filter((block) => block.trim() !== "");
  for (let index = 0; index < blocks.length - 1; index += 1) {
    const pair = [blocks[index], blocks[index + 1]];
    if (!pair.every((block) => shape.test(block.trim()))) continue;
    if (!pair.every((block) => block.length >= minLength)) continue;
    if (pair.some((block) => CITY_HEALTH_AGENCY.test(block) || ATTENDEE_COUNT.test(block)))
      continue;
    if (pair.some((block) => COUNTED_PEOPLE.test(block))) continue;
    return pair;
  }
  throw new Error(
    `${file} carries no adjacent pair of ${shape} blocks of at least ${minLength} characters that` +
      " is free of the agency and the count. A fixture standing for this artifact cannot be built" +
      " from it, and a hand-written miniature is not a substitute: see this file's header.",
  );
}

const TABLE_ROW = /^\|/;
const BULLET = /^[-*+] /;
const PARAGRAPH = /^\*\*/;

/** The claim half, planted at the far end of the block from the boundary that follows it. */
function plantAtStart(block, text) {
  const firstCell = block.match(/^\|[^|]*\| /);
  const lead = firstCell ? firstCell[0] : block.match(/^\s*(?:[-*+] |\d+\. )?/)[0];
  return `${block.slice(0, lead.length)}${text}. ${block.slice(lead.length)}`;
}

/** The claim half, planted at the far end of the block from the boundary that precedes it. */
function plantAtEnd(block, text) {
  return block.trimEnd().endsWith("|")
    ? block.replace(/\s*\|\s*$/, ` ${text}. |`)
    : `${block} ${text}.`;
}

/** How many characters separate two planted halves in the joined text. */
function separation(text, first = AGENCY_HALF, second = COUNT_HALF) {
  const start = text.indexOf(first);
  const end = text.indexOf(second);
  expect(start, `"${first}" was planted intact`).toBeGreaterThan(-1);
  expect(end, `"${second}" was planted intact`).toBeGreaterThan(-1);
  return end - (start + first.length);
}

/**
 * A two-block document built out of two real adjacent blocks, with the agency half at the START of
 * the first and the count half at the END of the second, which is the layout the fourth round's
 * bound was measured against and the layout its fixture did not reproduce.
 */
function plantedSplit(file, options) {
  const [first, second] = realAdjacentBlocks(file, options);
  const document = `${plantAtStart(first, AGENCY_HALF)}\n${plantAtEnd(second, COUNT_HALF)}`;
  expect(
    separation(document),
    `${file}: the planted halves must sit further apart than PROXIMITY, or this fixture is the` +
      " miniature this file's header is about",
  ).toBeGreaterThan(PROXIMITY);
  return document;
}

describe("blocksOf / isParagraph", () => {
  it("splits paragraphs, list items and table rows into their own blocks", () => {
    const blocks = blocksOf(
      ["a paragraph", "wrapped onto two lines", "", "- a bullet", "| a | row |", "1. an item"].join(
        "\n",
      ),
    );
    const kept = blocks.filter((block) => block.trim() !== "");
    expect(kept).toEqual([
      "\na paragraph\nwrapped onto two lines",
      "- a bullet",
      "| a | row |",
      "1. an item",
    ]);
  });

  it("classifies only the prose block as a paragraph", () => {
    expect(isParagraph("a sentence about DOHMH")).toBe(true);
    expect(isParagraph("- a bullet")).toBe(false);
    expect(isParagraph("| T-9 | a row |")).toBe(false);
    expect(isParagraph(" * a doc comment bullet")).toBe(false);
  });
});

describe("pairsAgencyWithCount", () => {
  it("flags the agency with an outright count phrase", () => {
    expect(pairsAgencyWithCount(`F-101 headcount drives ${CLAIM}.`)).toBe(true);
    expect(pairsAgencyWithCount("Attendance decides the Health Department's permit.")).toBe(true);
  });

  it("flags the agency with a counted quantity of people", () => {
    expect(pairsAgencyWithCount(`${CLAIM} at 75 or more guests.`)).toBe(true);
  });

  it("does not flag the agency alone, a count alone, or a countless noun", () => {
    expect(pairsAgencyWithCount("DOHMH requires a temporary food-service permit.")).toBe(false);
    expect(pairsAgencyWithCount("The event expects 75 or more guests.")).toBe(false);
    expect(pairsAgencyWithCount("DOHMH publishes the guest list requirements.")).toBe(false);
  });

  it("does not flag New York STATE's department, whose threshold is published", () => {
    const sdoh = "New York State's Department of Health publishes a 50-attendee threshold.";
    expect(pairsAgencyWithCount(sdoh)).toBe(false);
    expect(pairsAgencyWithCount("SDOH Department of Health: 50 or more attendees.")).toBe(false);
  });

  /**
   * ITEM 3 of the fourth PR #247 round: the distance bound was applied everywhere, so for the
   * `guests / attendees / people / RSVPs / patrons` vocabulary the check was effectively
   * SENTENCE-level and a claim stated across two sentences of one dated record passed.
   *
   * Rebuilt in the fifth round out of a REAL dated record rather than a three-line imitation of
   * one. `docs/BASELINE.md`'s records have a median length of 989 characters, and the claim is
   * planted at the two ends of one of them.
   */
  const TWO_SENTENCE_RECORD = (() => {
    const [record] = realAdjacentBlocks("docs/BASELINE.md", {
      shape: PARAGRAPH,
      minLength: 700,
    });
    const planted = plantAtEnd(plantAtStart(record, AGENCY_HALF), COUNTED_HALF);
    expect(
      separation(planted, AGENCY_HALF, COUNTED_HALF),
      "the planted halves are further apart than PROXIMITY",
    ).toBeGreaterThan(PROXIMITY);
    return planted;
  })();

  it("item 3: flags a claim stated across two sentences of one real dated record", () => {
    expect(pairsAgencyWithCount(TWO_SENTENCE_RECORD)).toBe(true);
  });

  it("item 3: keeps the distance bound where the file kind asks for it", () => {
    expect(pairsAgencyWithCount(TWO_SENTENCE_RECORD, { bounded: true })).toBe(false);
    expect(BOUNDED_EXTENSIONS).toEqual([".ts", ".tsx"]);
  });

  it("item 3: the compressed form of the same claim fires either way", () => {
    const compressed = "DOHMH requires the permit at 75 or more guests.";
    expect(pairsAgencyWithCount(compressed)).toBe(true);
    expect(pairsAgencyWithCount(compressed, { bounded: true })).toBe(true);
  });
});

/**
 * ITEM 1 of the fifth PR #247 round, and the reason for this file's header.
 *
 * Each of these is built from real blocks of a real artifact at their real width, and each of them
 * PASSED the scan as it stood before this round: the halves sit thousands of characters apart, and
 * the cross-boundary pass measured `PROXIMITY` over the concatenated pair.
 */
describe("scanFile: the cross-boundary pass, at the artifacts' real width", () => {
  it("item 1: flags the claim split across two real adjacent register rows", () => {
    const document = plantedSplit("docs/OPEN-QUESTIONS.md", {
      shape: TABLE_ROW,
      minLength: 1000,
    });
    expect(scanFile(document)).toHaveLength(1);
  });

  it("item 1: flags the claim split across two real adjacent bullets", () => {
    const document = plantedSplit("docs/PRD.md", { shape: BULLET, minLength: 400 });
    expect(scanFile(document)).toHaveLength(1);
  });

  it("item 1: flags the claim split across two real adjacent dated records", () => {
    const document = plantedSplit("docs/BASELINE.md", { shape: PARAGRAPH, minLength: 700 });
    expect(scanFile(document)).toHaveLength(1);
  });

  it("item 1: flags the claim split between a real record and the bullet under it", () => {
    const [record] = realAdjacentBlocks("docs/BASELINE.md", { shape: PARAGRAPH, minLength: 700 });
    const [bullet] = realAdjacentBlocks("docs/PRD.md", { shape: BULLET, minLength: 400 });
    const document = `${plantAtStart(record, AGENCY_HALF)}\n\n${plantAtEnd(bullet, COUNT_HALF)}`;
    expect(separation(document)).toBeGreaterThan(PROXIMITY);
    expect(scanFile(document)).toHaveLength(1);
  });

  it("does not pair blocks that a third block separates", () => {
    const separated = [
      "F-101 `headcount` is a regulatory input.",
      "",
      "Nothing in this paragraph is about either half.",
      "",
      "The DOHMH permit is the gate here.",
    ].join("\n");
    expect(scanFile(separated)).toEqual([]);
  });

  /**
   * The false positive the paragraph filter was buying, kept out by the tier split rather than by
   * the distance bound. This is `docs/VERIFICATION-SOURCES.md` items 8 and 9 THEMSELVES, read out
   * of the file, not a miniature of them: the first records Parks' own published "attendance over
   * 500 people" and the second records DOHMH's portal gap. Two published facts, no claim between
   * them. The fourth round noted they sit 121 characters apart, so the old bound avoided this by
   * ONE character; the tier split avoids it structurally, because two numbered list items are not
   * two paragraphs and the ordinary-English count vocabulary pairs only between paragraphs.
   */
  it("does not pair VERIFICATION-SOURCES items 8 and 9, which are two published facts", () => {
    const dossier = read("docs/VERIFICATION-SOURCES.md");
    const start = dossier.indexOf("### 8. R5 — TUA trigger reconciliation");
    const end = dossier.indexOf("### 10. A2 — Sound permit on private property");
    expect(start, "the dossier carries item 8").toBeGreaterThan(-1);
    expect(end, "the dossier carries item 10").toBeGreaterThan(start);
    const items = dossier.slice(start, end);
    expect(items).toContain("attendance over 500 people");
    expect(items).toContain("DOHMH application path");
    expect(scanFile(items)).toEqual([]);
  });
});

/**
 * ITEM 2 of the fifth PR #247 round. Inside a block the distance bound survived in `.ts` and
 * `.tsx`, and the struck clause historically sat in code comments in exactly two such files. The
 * round planted it back into `apps/api/src/rsvps.ts` as an ordinary three-line `//` comment spread
 * over two sentences and the whole suite stayed green, while the byte-identical text in a `.md`
 * file failed.
 *
 * `docs/BASELINE.md`'s correction record says of those comments that "it is removed in place and
 * stays removed", so the bound does not apply in those files. This is the fixture for that, and it
 * is a literal string because it stands for the guard's behaviour on a file kind rather than for
 * the contents of an artifact. It FAILED before the fix: `bounded: true` was what those files got.
 *
 * The count half here is the ORDINARY-ENGLISH one ("75 or more guests"), because that is the half
 * the bound governs: `ATTENDEE_COUNT` is unbounded inside a block in every file kind, so a comment
 * naming the agency and the literal `headcount` field is flagged in code today. The gap is exactly
 * the vocabulary the struck clause's own register row states the threshold in.
 */
describe("scanFile: the bound does not readmit the clause to the files it was struck from", () => {
  const REPLANTED_COMMENT = [
    "// Admission is `events.capacity`, the confirmed venue/event capacity, and a NULL capacity",
    "// means no enforced limit (spec AC 2, resolving SPEC-CONFLICT #209 on 2026-08-03).",
    "// DOHMH publishes the temporary food-service permit for events of this kind, together",
    "// with the organizer notification that goes with it and the vendor permit each operator",
    "// carries. Which of those apply follows the same input as everything else on this path:",
    "// the assembly gate opens at 75 or more guests recorded at intake, and the permit set",
    "// moves with it, so raising an RSVP cap silently moved the event's permit findings.",
  ].join("\n");

  it("item 2: the two files the correction record names are scanned unbounded", () => {
    expect(UNBOUNDED_RECORD_FILES).toEqual(["apps/api/src/rsvps.ts", "apps/api/src/rsvps.test.ts"]);
    for (const file of UNBOUNDED_RECORD_FILES) {
      expect(read(file), `${file} exists to be scanned`).toContain("SPEC-CONFLICT #209");
    }
  });

  it("item 2: the replanted comment is flagged unbounded and was missed bounded", () => {
    expect(separation(REPLANTED_COMMENT, AGENCY_HALF, COUNTED_HALF)).toBeGreaterThan(PROXIMITY);
    expect(scanFile(REPLANTED_COMMENT, { bounded: false, allowOptOut: true })).toHaveLength(1);
    expect(scanFile(REPLANTED_COMMENT, { bounded: true, allowOptOut: true })).toEqual([]);
  });

  /**
   * AN EXPECTED MISS, not a design property, and the fourth round's version of this fixture said
   * the opposite. The bound is kept in every other `.ts` and `.tsx` file because dropping it there
   * was measured to cost eight false positives, seven adjacent `describe`/`it` pairs in
   * `packages/engine/src/acceptance.test.ts` and one in `apps/api/src/plan.test.ts`. The cost of
   * keeping it is this: the same text in an ordinary code file goes past.
   */
  it("item 2: EXPECTED MISS — the same text in any other code file is not flagged", () => {
    expect(scanFile(REPLANTED_COMMENT, { bounded: true })).toEqual([]);
  });
});

describe("scanFile: the code opt-out", () => {
  const REGRESSION_TEST = [
    "  // guard: asserts-independence. This block asserts DOHMH findings do not move with the count.",
    "  it('DOHMH findings are invariant under headcount', () => {",
    "    expect(dohmhFindings(20)).toEqual(dohmhFindings(500));",
    "  });",
  ].join("\n");

  it("item 7: the marker exempts the block in a bounded (code) file", () => {
    expect(scanFile(REGRESSION_TEST, { bounded: true, allowOptOut: true })).toEqual([]);
  });

  it("item 7: the same text without the marker is flagged", () => {
    const unmarked = REGRESSION_TEST.replace(OPT_OUT_MARKER, "no marker here");
    expect(scanFile(unmarked, { bounded: true, allowOptOut: true })).toHaveLength(1);
  });

  it("item 7: prose cannot opt out, however the marker is spelled", () => {
    const prose = `${CLAIM} at 75 or more guests. ${OPT_OUT_MARKER}`;
    expect(scanFile(prose)).toHaveLength(1);
    expect(scanFile(prose, { allowOptOut: false })).toHaveLength(1);
  });

  it("item 7: the marker does not exempt the neighbour it is not in", () => {
    const pair = [
      `  // ${OPT_OUT_MARKER}`,
      "  const a = 1;",
      "",
      "  // F-101 headcount is what DOHMH reads.",
    ].join("\n");
    expect(scanFile(pair, { bounded: true, allowOptOut: true })).toHaveLength(1);
  });

  /**
   * ITEM 4 of the fifth PR #247 round. A new guard fixture under `scripts/*.mjs` was scanned with
   * `allowOptOut: false`, because the opt-out was tied to `BOUNDED_EXTENSIONS`. So the file was
   * reported as a live claim AND the marker-location assertion told its author the marker is
   * honoured in `.ts`/`.tsx` only, leaving no remedy but a fourth entry in `GUARD_SOURCES`, which
   * `spec-conflict-resolutions.test.mjs` calls a governance action rather than a fix.
   *
   * This is the five-line file that round executed, verbatim. It FAILED twice before the fix.
   */
  const NEW_GUARD_FIXTURE = [
    "// guard: asserts-independence. The scan must still flag a DOHMH claim keyed on a count.",
    "const PLANTED = 'DOHMH requires a temporary food-service permit at 75 or more guests.';",
    "",
    "export const flagsThePlantedClaim = (scan) => scan(PLANTED).length === 1;",
  ].join("\n");

  it("item 4: the marker is honoured in every scanned code extension, not just the bounded ones", () => {
    expect(OPT_OUT_EXTENSIONS).toEqual([".ts", ".tsx", ".mjs", ".js"]);
    for (const extension of BOUNDED_EXTENSIONS) expect(OPT_OUT_EXTENSIONS).toContain(extension);
    expect(scanFile(NEW_GUARD_FIXTURE, { bounded: false, allowOptOut: true })).toEqual([]);
  });

  it("item 4: the same fixture without the marker is still flagged", () => {
    const unmarked = NEW_GUARD_FIXTURE.replace(OPT_OUT_MARKER, "no marker here");
    expect(scanFile(unmarked, { bounded: false, allowOptOut: true })).toHaveLength(1);
  });
});

/**
 * ITEM 3 of the fifth PR #247 round. `ATTENDEE_COUNT` and `COUNTED_PEOPLE` declare the same count
 * nouns and did not carry the same ones: `RSVPs` and `patrons` were declared in `COUNTED_PEOPLE`
 * and appeared in neither phrasing of `ATTENDEE_COUNT`, and `COUNTED_PEOPLE` needs a numeral these
 * phrasings do not carry, so both expressions missed them. The grid is asserted cell by cell so
 * the two lists cannot drift apart again.
 *
 * Six of these fourteen cells FAILED before the fix: `head`/"number of heads", both `person`
 * cells, both `RSVP` cells and both `patron` cells, minus the four that already passed.
 */
describe("the count vocabulary: 7 nouns by 2 phrasings, every cell asserted", () => {
  const NOUNS = [
    ["guest", "guest count", "number of guests"],
    ["attendee", "attendee count", "number of attendees"],
    ["head", "headcount", "number of heads"],
    ["people", "people count", "number of people"],
    ["person", "person count", "number of persons"],
    ["RSVP", "RSVP count", "number of RSVPs"],
    ["patron", "patron count", "number of patrons"],
  ];

  for (const [noun, outright, ofPhrase] of NOUNS) {
    for (const phrasing of [outright, ofPhrase]) {
      it(`flags "the ${phrasing}" under an agency mention`, () => {
        const claim = `DOHMH keys its temporary food-service permit on the ${phrasing} recorded at intake.`;
        expect(pairsAgencyWithCount(claim), `${noun}: "${phrasing}"`).toBe(true);
      });
    }
  }

  /** The three sentences the fifth round executed against `docs/BASELINE.md`, verbatim. */
  it("item 3: the three planted RSVP and patron sentences are flagged", () => {
    for (const claim of [
      "the RSVP count is a regulatory input driving the DOHMH thresholds",
      "DOHMH keys its temporary food-service permit on the number of RSVPs recorded at intake",
      "DOHMH requires a permit once the patron count reaches seventy-five",
    ]) {
      expect(pairsAgencyWithCount(claim), claim).toBe(true);
    }
  });

  it("a count noun with no agency is still not a claim", () => {
    expect(pairsAgencyWithCount("The RSVP count is recorded at intake.")).toBe(false);
    expect(pairsAgencyWithCount("Parks publishes a threshold on the patron count.")).toBe(false);
  });
});

describe("the pin machinery", () => {
  const registerPin = HISTORICAL_RECORDS.find((pin) => pin.file === "docs/OPEN-QUESTIONS.md");

  /** The pinned row's shape, with the padding a neighbouring edit moves. */
  const row = (id, padding) =>
    `| ${id}${" ".repeat(padding)}| ~~F-302 and F-306 admission-limit source ([SPEC-CONFLICT #209](x))~~ | Product + architecture owners${" ".repeat(padding)}| **RESOLVED 2026-08-03:** ` +
    `\`headcount\` is a regulatory input driving the DOHMH thresholds.${" ".repeat(padding)}|`;

  /**
   * ITEM 4 of the fourth PR #247 round. Base commit 0f13294 lengthened another row's cell and
   * re-aligned the whole table: 11 register rows changed bytes, the pinned row's resolution cell
   * grew by 208 spaces, and NOT ONE WORD CHANGED. The `stable` hook normalized the ID cell's
   * padding only, so the digest moved, the pin reported the wording as changed, and the row then
   * read as an unpinned live fabricated regulatory claim.
   */
  it("item 4: intra-cell padding anywhere in the row does not move the digest", () => {
    expect(stableRegisterRow(row("T-6", 2))).toBe(stableRegisterRow(row("T-6", 210)));
  });

  it("item 4: renumbering the row does not move the digest either", () => {
    expect(stableRegisterRow(row("T-6", 2))).toBe(stableRegisterRow(row("T-12", 2)));
  });

  it("item 4: a single space is inside the digest, so wording still counts", () => {
    const reworded = row("T-6", 2).replace("regulatory input", "regulatory INPUT");
    expect(stableRegisterRow(reworded)).not.toBe(stableRegisterRow(row("T-6", 2)));
  });

  /**
   * ITEM 5 of the fourth PR #247 round. The anchor was `SPEC-CONFLICT #209`, and the suite's own
   * `#209` test establishes that identifier as the one that does not move and tells contributors
   * to cite it. So any new row citing the issue matched the anchor, and the exactly-once assertion
   * fired and told the author an approval record had been duplicated when nothing protected had
   * been touched.
   */
  it("item 5: the anchor matches the protected row and not another row citing #209", () => {
    const register = [
      row("T-6", 2),
      "| T-11 | a new question | Product owner | Cites [SPEC-CONFLICT #209](x) as the identifier. |",
    ].join("\n");
    const matched = blocksOf(register).filter((block) => block.includes(registerPin.anchor));
    expect(matched).toHaveLength(1);
    expect(matched[0]).toContain("T-6");
  });

  it("the digest is over the whole block, so a pin cannot leave an unguarded window", () => {
    const pin = { sha256: "unused" };
    expect(pinnedDigest(pin, "a")).not.toBe(pinnedDigest(pin, "a "));
  });

  /**
   * The four benign adjacent pairs are the measured price of running the cross-boundary pass
   * unbounded in prose. They are pinned by digest rather than allowlisted by file, and this is the
   * fixture for that difference: an allowlist would let a live claim be written into one of these
   * blocks later, and a digest cannot.
   */
  it("a benign pair's pin does not survive a wording change to either block", () => {
    const pin = BENIGN_ADJACENT_PAIRS.find((entry) => entry.file === "docs/ARCHITECTURE.md");
    const blocks = blocksOf(read(pin.file)).filter((block) => block.trim() !== "");
    const index = blocks.findIndex((block) => block.includes(pin.anchor));
    expect(index, `${pin.file} carries the pinned pair's first block`).toBeGreaterThan(-1);
    const pair = `${blocks[index]}\n${blocks[index + 1]}`;
    expect(pinnedDigest(pin, pair)).toBe(pin.sha256);
    expect(pinnedDigest(pin, pair.replace("regulatory input", "regulatory INPUT"))).not.toBe(
      pin.sha256,
    );
  });

  it("every benign pair states why it is two facts rather than one claim", () => {
    expect(BENIGN_ADJACENT_PAIRS).toHaveLength(4);
    for (const pin of BENIGN_ADJACENT_PAIRS) {
      expect(pin.why.length, `${pin.file}: ${pin.pair}`).toBeGreaterThan(80);
    }
  });
});

/**
 * The two phrasings `spec-conflict-resolutions.test.mjs` declares as knowingly uncaught. They are
 * EXACTLY TWO, and each is asserted to be missed. If a later change starts catching one, this
 * suite fails and the disclosure has to be rewritten in the same commit rather than left standing
 * as an overstatement of what the scan cannot do.
 */
describe("the declared misses, asserted as expected misses", () => {
  it("misses the circumlocution the repository's own correction records use", () => {
    expect(pairsAgencyWithCount("The F-101 intake field drives the DOHMH thresholds.")).toBe(false);
  });

  it("misses a bare threshold numeral with no count noun", () => {
    expect(pairsAgencyWithCount("DOHMH requires a permit above 75.")).toBe(false);
  });
});
