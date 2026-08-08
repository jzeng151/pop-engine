import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ATTENDEE_COUNT,
  ATTENDEE_COUNT_SOURCE,
  BENIGN_ADJACENT_PAIRS,
  BOUNDED_EXTENSIONS,
  CITY_HEALTH_AGENCY,
  COUNTED_PEOPLE,
  COUNTED_PEOPLE_SOURCE,
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
  scanOptionsFor,
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
 * Each of the defects the fourth, fifth and sixth rounds found has a case here that FAILED before
 * its fix and passes after, and each names the defect it stands for. The three knowingly-uncaught
 * phrasings are here too, as EXPECTED MISSES, asserted to be missed, so a later change that starts
 * catching one fails this suite and forces the disclosure in `spec-conflict-resolutions.test.mjs`
 * to be brought back into line. A disclosure that is only prose drifts; this is the part a test can
 * hold.
 *
 * A SECOND WAY A FIXTURE CAN FAIL TO BE A TEST, which the sixth round found twice here: it can
 * assert something other than what its name says. The 7-by-2 grid was named for two expressions and
 * drove one, because no cell carried a numeral. "The marker does not exempt the neighbour it is not
 * in" was named for a boundary and tested a block, because its neighbour paired on its own and was
 * flagged whether or not the boundary was ever read. Both passed for as long as they existed. When
 * adding a case, check that the thing it names is the thing that decides its result.
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

  it("flags the agency's spelled-out name with an ampersand and without the prefix", () => {
    expect(
      pairsAgencyWithCount("The Health & Mental Hygiene permit turns on the guest count."),
    ).toBe(true);
    expect(
      pairsAgencyWithCount("Department of Health & Mental Hygiene: 75 or more attendees."),
    ).toBe(true);
    expect(pairsAgencyWithCount("Health and Mental Hygiene reads the attendance figure.")).toBe(
      true,
    );
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

  /**
   * ITEM 3 of the sixth PR #247 round, in the half that is about the pins.
   *
   * A block that pairs on its own used to remove BOTH of its own boundaries from this pass: the
   * pair `(i, i+1)` was formed only when `i` did not pair alone and `i+1` neither paired alone nor
   * was opted out. On a block whose own pairing is then EXEMPTED at the reporting site, that is a
   * blind spot rather than a de-duplication: on this tree it shadowed 8 boundaries (4 pinned
   * records, 2 sides each) plus 2 at the live opt-out block in `apps/api/src/rsvps.test.ts`.
   *
   * This is the fifth round's own experiment, built from the REAL pinned record: the count half
   * planted into the paragraph immediately after `docs/BASELINE.md`'s 2026-08-03 T-6 decision. It
   * PASSED before this round. The pin is a content assertion over specific bytes and it stays
   * exactly that; it no longer exempts the two boundaries around those bytes.
   */
  it("item 3: a block that pairs alone does not blank the boundaries around it", () => {
    const pin = HISTORICAL_RECORDS.find((entry) => entry.anchor.includes("T-6 / SPEC-CONFLICT"));
    const blocks = blocksOf(read(pin.file)).filter((block) => block.trim() !== "");
    const record = blocks.find((block) => block.includes(pin.anchor));
    expect(record, "docs/BASELINE.md carries the pinned 2026-08-03 record").toBeDefined();

    const planted = `${COUNTED_HALF[0].toUpperCase()}${COUNTED_HALF.slice(1)}.`;
    const flagged = scanFile(`${record}\n\n${planted}`);
    // The record itself, once, as its own block: that is what the pin covers, and its digest is
    // unchanged. The pair is the new finding, and the pin's digest does not match it.
    expect(flagged.map((item) => item.kind)).toEqual(["block", "pair"]);
    expect(pinnedDigest(pin, flagged[0].text)).toBe(pin.sha256);
    expect(pinnedDigest(pin, flagged[1].text)).not.toBe(pin.sha256);
    expect(flagged[1].text).toContain(planted);
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

  /**
   * ITEM 2 of the sixth PR #247 round. Both of the fifth round's fixes were single clauses inside
   * `spec-conflict-resolutions.test.mjs`'s own `flaggedBlocks()`, and NOTHING DROVE THE SELECTION:
   * reverting either one left all 67 of this file's cases green. The fixture that read as their
   * test asserted that an array equals two paths and that both files cite `SPEC-CONFLICT #209`,
   * which says nothing about scanning; its sibling drove `scanFile` with `bounded` set by hand.
   * Neither connected a file to an option.
   *
   * So the selection is a function of a path now (`scanOptionsFor`), and this is a table of paths
   * with the options each must get. Dropping the `UNBOUNDED_RECORD_FILES` clause fails the two
   * record-file rows; restoring the pre-fix `allowOptOut = BOUNDED_EXTENSIONS.some(...)` fails the
   * `.mjs` and `.js` rows.
   */
  it("item 2: every file kind gets the options its rules give it", () => {
    const FILES = [
      { relative: "docs/BASELINE.md", bounded: false, allowOptOut: false },
      { relative: "specs/F-302-rsvp-guest-list.md", bounded: false, allowOptOut: false },
      { relative: "packages/engine/src/acceptance.test.ts", bounded: true, allowOptOut: true },
      {
        relative: "apps/web/app/events/[id]/guests/guest-list.tsx",
        bounded: true,
        allowOptOut: true,
      },
      // The two files `docs/BASELINE.md`'s correction record says the clause "is removed in place
      // and stays removed". Code, so the marker is honoured; unbounded, so the bound cannot
      // readmit the clause to them.
      { relative: "apps/api/src/rsvps.ts", bounded: false, allowOptOut: true },
      { relative: "apps/api/src/rsvps.test.ts", bounded: false, allowOptOut: true },
      // A guard fixture under `scripts/`: unbounded like prose, and the marker is its remedy.
      { relative: "scripts/new-guard.test.mjs", bounded: false, allowOptOut: true },
      { relative: "apps/web/next.config.js", bounded: false, allowOptOut: true },
    ];

    for (const { relative, bounded, allowOptOut } of FILES) {
      expect(scanOptionsFor(relative), relative).toEqual({ bounded, allowOptOut });
    }
    // The two record files are named by the correction record, so they have to be real files that
    // carry the citation, not just rows in the table above.
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

  /**
   * ITEM 3 of the sixth PR #247 round, in the half that is about the opt-out. This test's NAME
   * promised boundary behaviour and its assertion tested block behaviour: the neighbour it used
   * ("F-101 headcount is what DOHMH reads") paired on its own, so it was flagged by the
   * single-block pass whether or not the boundary was ever read, and the case passed while the
   * opt-out was in fact removing both of its own boundaries from the cross-boundary pass.
   *
   * The neighbour carries ONLY the count half now, so the flag it produces can come from nowhere
   * but the boundary it shares with the marked block. The marker still exempts what it marks: the
   * marked block names the agency and is not flagged on its own.
   */
  it("item 7: the marker does not exempt the boundary with the neighbour it is not in", () => {
    const marked = [`  // ${OPT_OUT_MARKER}. DOHMH findings do not move.`, "  const a = 1;"].join(
      "\n",
    );
    const neighbour = "  // The assembly gate opens at 75 or more guests recorded at intake.";
    expect(scanFile(marked, { bounded: true, allowOptOut: true })).toEqual([]);
    expect(scanFile(neighbour, { bounded: true, allowOptOut: true })).toEqual([]);
    const flagged = scanFile(`${marked}\n\n${neighbour}`, { bounded: true, allowOptOut: true });
    expect(flagged.map((item) => item.kind)).toEqual(["pair"]);
    expect(flagged[0].text).toContain(OPT_OUT_MARKER);
    expect(flagged[0].text).toContain("75 or more guests");
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
 * ITEM 3 of the fifth PR #247 round, and ITEM 1 of the sixth.
 *
 * `ATTENDEE_COUNT` and `COUNTED_PEOPLE` declare the same count nouns and did not carry the same
 * ones. The fifth round found the miss in one direction: `RSVPs` and `patrons` were declared in
 * `COUNTED_PEOPLE` and appeared in neither phrasing of `ATTENDEE_COUNT`. It fixed that direction
 * and did not check the other, so `persons` and `heads` stayed declared in `ATTENDEE_COUNT` and
 * missing from both alternatives of `COUNTED_PEOPLE`, and "DOHMH requires a temporary food-service
 * permit for indoor assembly occupancies used by 75 PERSONS OR MORE" passed while the same sentence
 * ending "75 or more GUESTS" failed. That phrasing is not contrived: "75 persons or more" is the
 * Building Code's own text, quoted in the published ruleset at `rules/nyc-rules.v2.11.json`.
 *
 * THE GRID WAS ONE-SIDED, and that is why nothing caught it. Its claim strings carried no numeral,
 * so `COUNTED_PEOPLE` could never fire in any of its fourteen cells: fourteen assertions about
 * `ATTENDEE_COUNT` wearing the name of a grid over both. It is 7 nouns by THREE phrasings now, and
 * the third carries the numeral.
 *
 * The set equality below is the part that does not depend on anyone remembering to add a row. It
 * is DERIVED FROM THE TWO SOURCES rather than restated here, so a noun added to one expression and
 * forgotten in the other fails whether or not the grid grew with it.
 */
describe("the count vocabulary: 7 nouns by 3 phrasings, every cell asserted", () => {
  const NOUNS = [
    ["guest", "guest count", "number of guests", "75 or more guests"],
    ["attendee", "attendee count", "number of attendees", "75 or more attendees"],
    ["head", "headcount", "number of heads", "75 or more heads"],
    ["people", "people count", "number of people", "75 or more people"],
    ["person", "person count", "number of persons", "75 persons or more"],
    ["RSVP", "RSVP count", "number of RSVPs", "75 or more RSVPs"],
    ["patron", "patron count", "number of patrons", "75 or more patrons"],
  ];

  for (const [noun, outright, ofPhrase, counted] of NOUNS) {
    for (const phrasing of [outright, ofPhrase]) {
      it(`flags "the ${phrasing}" under an agency mention`, () => {
        const claim = `DOHMH keys its temporary food-service permit on the ${phrasing} recorded at intake.`;
        expect(pairsAgencyWithCount(claim), `${noun}: "${phrasing}"`).toBe(true);
      });
    }

    it(`flags "${counted}" under an agency mention`, () => {
      const claim = `DOHMH requires a temporary food-service permit for events of ${counted}.`;
      expect(pairsAgencyWithCount(claim), `${noun}: "${counted}"`).toBe(true);
    });
  }

  /**
   * The count nouns one alternation of one source declares, canonicalized so the two expressions'
   * singular and plural spellings compare as the same word. Read out of the source string rather
   * than written down again: a list restated here is a third place to forget a noun.
   */
  const nounsIn = (source, pattern) => {
    const match = source.match(pattern);
    expect(match, `${pattern} matches its source`).not.toBeNull();
    return new Set(match[1].split("|").map((noun) => noun.toLowerCase().replace(/s$/, "")));
  };

  it("item 1: both expressions declare the same count nouns, in every alternation", () => {
    const declared = [
      [
        "ATTENDEE_COUNT, the outright phrasing",
        nounsIn(ATTENDEE_COUNT_SOURCE, /\(\?:([^)]+)\) \?count/),
      ],
      [
        "ATTENDEE_COUNT, the 'number of' phrasing",
        nounsIn(ATTENDEE_COUNT_SOURCE, /number of \(\?:([^)]+)\)/),
      ],
      [
        "COUNTED_PEOPLE, numeral first",
        nounsIn(COUNTED_PEOPLE_SOURCE, /\\\+ \?\)\?\(\?:([^)]+)\)/),
      ],
      ["COUNTED_PEOPLE, noun first", nounsIn(COUNTED_PEOPLE_SOURCE, /\|\\b\(\?:([^)]+)\)/)],
    ];
    const [, first] = declared[0];
    expect(first.size, "the vocabulary is the seven nouns the grid above drives").toBe(7);
    for (const [name, nouns] of declared) {
      expect([...nouns].sort(), `${name} declares the same nouns as the outright phrasing`).toEqual(
        [...first].sort(),
      );
    }
  });

  /**
   * The two sentences the sixth round executed against `docs/BASELINE.md`, verbatim. The first
   * PASSED before this round and is the Building Code's own wording: `rules/nyc-rules.v2.11.json`
   * quotes "75 persons or more" in the published rule this sentence is about. The second is the
   * same sentence with one noun swapped for another the guard itself declares as the same
   * vocabulary, and it failed. One noun flipped the result.
   */
  it("item 1: the Building Code's own 'persons' wording is flagged, like 'guests'", () => {
    const inTheCodesWords =
      "DOHMH requires a temporary food-service permit for indoor assembly occupancies used by 75" +
      " persons or more, so the F-101 intake count is a regulatory trigger.";
    const inGuests =
      "DOHMH requires a temporary food-service permit for events of 75 or more guests.";
    expect(pairsAgencyWithCount(inTheCodesWords)).toBe(true);
    expect(pairsAgencyWithCount(inGuests)).toBe(true);
  });

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
    expect(BENIGN_ADJACENT_PAIRS).toHaveLength(6);
    for (const pin of BENIGN_ADJACENT_PAIRS) {
      expect(pin.why.length, `${pin.file}: ${pin.pair}`).toBeGreaterThan(80);
    }
  });
});

/**
 * The phrasings `spec-conflict-resolutions.test.mjs` declares as knowingly uncaught. They are
 * EXACTLY THREE, and each is asserted to be missed. If a later change starts catching one, this
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

  /**
   * A THIRD declared miss, added in the sixth PR #247 round with the reason it is declared rather
   * than closed: `DOH` names the STATE department at least as readily as the city one in this
   * domain, it appears nowhere in this tree, and `CITY_HEALTH_AGENCY` exists in the shape it has
   * because flagging the state agency's real published attendance threshold is the false positive
   * this guard has already had once.
   */
  it("misses the bare DOH acronym, which names the state department just as readily", () => {
    expect(pairsAgencyWithCount("DOH requires a permit at 75 or more guests.")).toBe(false);
  });
});
