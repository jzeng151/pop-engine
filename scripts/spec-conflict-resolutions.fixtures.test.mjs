import { readFileSync, readdirSync } from "node:fs";
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
  normalizeForMatching,
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

  /**
   * ITEM 3 of the seventh PR #247 review round. `crowd size` and `party size` survived deletion
   * with the whole suite green, and so did the health department's own brand name, which is the
   * form `docs/VERIFICATION-SOURCES.md` cites the portal under. Nothing drove any of the three.
   */
  it("item 3: flags the two size phrases and the brand the department publishes under", () => {
    expect(pairsAgencyWithCount("DOHMH keys the permit on the crowd size at intake.")).toBe(true);
    expect(pairsAgencyWithCount("The party size decides the Health Department's permit.")).toBe(
      true,
    );
    expect(pairsAgencyWithCount("NYC Health requires the permit at 75 or more guests.")).toBe(true);
  });

  it("does not flag the agency alone, a count alone, or a countless noun", () => {
    expect(pairsAgencyWithCount("DOHMH requires a temporary food-service permit.")).toBe(false);
    expect(pairsAgencyWithCount("The event expects 75 or more guests.")).toBe(false);
    expect(pairsAgencyWithCount("DOHMH publishes the guest list requirements.")).toBe(false);
  });

  /**
   * ITEM 3 of the eighth PR #247 round, in the half that is about the agency expression. This case
   * was named "with an ampersand AND WITHOUT THE PREFIX" and asserted on strings that matched
   * identically whether or not `(?:Department of )?` was there, because the alternation is
   * unanchored. It names the ampersand, which is the half its assertions can distinguish: the
   * ampersand really is the difference between a match and no match.
   */
  it("flags the agency's spelled-out name with an ampersand", () => {
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

  /**
   * THE BOUND on the modifier window, and only the bound. The eighth round asserted the window with
   * three hand-written cells carrying plain lowercase adjectives, which is a declaration checked
   * against a declaration: three adjectives were the shape it happened to think of, and the shapes
   * it did not think of (a hyphen, a comma) were the ninth round's item 3. The window's POSITIVE
   * cases are a generated corpus axis now, over every noun, every phrasing, every formatting and
   * every wrap position. What a corpus over a window cannot state is where the window stops, so
   * that is what stays here, in both expressions that carry it.
   */
  it("stops the modifier window at two words, in both expressions", () => {
    expect(
      pairsAgencyWithCount("DOHMH keys the permit on the number of confirmed paying adult guests."),
    ).toBe(false);
    expect(
      pairsAgencyWithCount("DOHMH requires a permit for 75 or more confirmed paying adult guests."),
    ).toBe(false);
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

  /**
   * ITEM 4 of the eighth PR #247 round. The two `isParagraph` guards on the ordinary-English tier
   * were individually undriven: deleting EITHER one left the whole suite green, because both
   * existing negatives put two blocks of the SAME non-paragraph kind side by side, so the surviving
   * check still suppressed them. Nothing covered a MIXED adjacency, which is the case the tier
   * split is specifically about: a paragraph naming the agency beside the bullet under it.
   *
   * Both directions, because each direction drives one of the two checks. The count half is the
   * ordinary-English one; the outright phrases pair across blocks of any kind by design.
   */
  it("item 4: does not pair a paragraph with the bullet under it, or a bullet with the paragraph under it", () => {
    const agency = "DOHMH publishes the temporary food-service permit for an indoor event.";
    const count = "The assembly gate opens at 75 or more guests recorded at intake.";
    expect(scanFile(`${agency}\n\n- ${count}`)).toEqual([]);
    expect(scanFile(`- ${agency}\n\n${count}`)).toEqual([]);
    // Neither block pairs on its own, so the empty result above is the boundary and nothing else.
    expect(pairsAgencyWithCount(agency)).toBe(false);
    expect(pairsAgencyWithCount(count)).toBe(false);
    // And the same two halves between two PARAGRAPHS are a finding, so the fixture is measuring
    // the block kinds rather than a claim that failed to be a claim.
    expect(scanFile(`${agency}\n\n${count}`)).toHaveLength(1);
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
 * ITEM 1 of the seventh PR #247 review round. Every count expression joins its words with a literal
 * single space and `blocksOf` reassembles a hard-wrapped paragraph into one block on purpose, so
 * the claim went past whenever a line break fell inside the count phrase.
 *
 * The first case is the record the seventh round planted as the newest dated record in the real
 * `docs/BASELINE.md`, verbatim. It added ZERO flags and left all 79 cases green.
 */
describe("scanFile: a block is read as one line of prose", () => {
  const PLANTED_RECORD = [
    "**Decision 2026-08-07 (product owner, issue #248, DOHMH indoor assembly threshold):** the temporary",
    "food-service permit and the organizer notification DOHMH publishes for an indoor event keyed on 75",
    "or more guests recorded at intake, so raising an RSVP cap moves the permit findings.",
  ].join("\n");

  it("item 1: flags the planted dated record, whose count phrase a wrap splits", () => {
    expect(PLANTED_RECORD).not.toContain("75 or more guests");
    expect(PLANTED_RECORD.replace(/\n/g, " ")).toContain("75 or more guests");
    expect(scanFile(PLANTED_RECORD)).toHaveLength(1);
  });

  /**
   * THE FLAGGED TEXT IS THE RAW BLOCK, which is what every pin digests. Normalizing the text a pin
   * covers would move all four digests at once and report the protected approvals as reworded.
   */
  it("item 1: the flag carries the raw block, so no pin's digest moves", () => {
    expect(scanFile(PLANTED_RECORD)[0].text).toBe(`\n${PLANTED_RECORD}`);
    for (const pin of HISTORICAL_RECORDS) {
      const block = blocksOf(read(pin.file)).find((item) => item.includes(pin.anchor));
      expect(pinnedDigest(pin, block), `${pin.file}: ${pin.record}`).toBe(pin.sha256);
    }
  });

  /**
   * The same defect in a REAL dated record rather than an imitation of one, per this file's header:
   * the record is read out of `docs/BASELINE.md` and wrapped at the width `.prettierrc` sets, and
   * the fixture asserts the dimension that hid the defect, that the wrap really does fall inside
   * the planted count phrase.
   */
  it("item 1: flags a real dated record, wrapped at this tree's own printWidth", () => {
    const [record] = realAdjacentBlocks("docs/BASELINE.md", { shape: PARAGRAPH, minLength: 700 });
    const wrap = (text) => {
      const lines = [""];
      for (const word of text.split(/\s+/)) {
        const line = lines[lines.length - 1];
        if (line === "") lines[lines.length - 1] = word;
        else if (`${line} ${word}`.length <= 100) lines[lines.length - 1] = `${line} ${word}`;
        else lines.push(word);
      }
      return lines.join("\n");
    };
    // Slide the claim along until the wrap falls INSIDE the count phrase, which is the dimension
    // that hid this defect. A wrap that leaves the phrase whole tests nothing.
    let wrapped;
    for (let offset = 0; offset < 20 && wrapped === undefined; offset += 1) {
      const candidate = wrap(
        plantAtStart(
          record,
          `${AGENCY_HALF} ${"x".repeat(offset)} for events of 75 or more guests`,
        ),
      );
      if (!candidate.includes("75 or more guests")) wrapped = candidate;
    }
    expect(wrapped, "some lead-in puts the wrap inside the planted count phrase").toBeDefined();
    expect(scanFile(wrapped)).toHaveLength(1);
  });

  it("item 1: flags a wrapped `//` comment, whose leader is normalized away", () => {
    const lineComment = [
      "// DOHMH publishes the temporary food-service permit for an indoor event keyed on the guest",
      "// count recorded at intake.",
    ].join("\n");
    expect(scanFile(lineComment, { bounded: true, allowOptOut: true })).toHaveLength(1);
  });

  /**
   * ITEM 1 of the EIGHTH PR #247 review round. The normalization stripped `` ` `` and `*` and
   * called them "the emphasis and inline-code markers". Markdown has two emphasis markers and this
   * tree writes the other one: 88 underscore-emphasis spans in 14 scanned files, against 94
   * asterisk spans, and `prettier` rewrites `*italic*` into `_italic_` whenever `pnpm format` runs.
   *
   * The first case is the record the eighth round planted as the newest dated record in the real
   * `docs/BASELINE.md`, verbatim. It added ZERO flags; the same record with the two underscores
   * removed added one. Two characters were the whole difference.
   */
  const UNDERSCORED_RECORD = [
    "**Decision 2026-08-07 (product owner, issue #248, DOHMH indoor assembly threshold):** the temporary",
    "food-service permit and the organizer notification DOHMH publishes for an indoor event are keyed on",
    "the number of _guests_ recorded at intake, not on the vendor count, so raising an RSVP cap moves the",
    "permit findings.",
  ].join("\n");

  it("item 1: flags the planted record whose count noun carries underscore emphasis", () => {
    expect(scanFile(UNDERSCORED_RECORD)).toHaveLength(1);
    // The control the eighth round ran beside it: the same record with the emphasis removed. Both
    // are flagged now, and the point of the pair is that the guard no longer tells them apart.
    expect(scanFile(UNDERSCORED_RECORD.replace(/_guests_/, "guests"))).toHaveLength(1);
  });

  /**
   * ITEM 2 of the NINTH round, which is the same record with the same word in the tree's commonest
   * inline construct instead of one of its rarest. Planted into the real `docs/BASELINE.md` between
   * two clean paragraphs it added no flag, and the same record with the two quotation marks deleted
   * added one: two characters again, one round later, which is why the enumeration above exists
   * rather than another remembered marker.
   */
  it("item 2: flags the planted record whose count noun is quoted", () => {
    const quoted = UNDERSCORED_RECORD.replace("_guests_", '"guests"');
    expect(scanFile(quoted)).toHaveLength(1);
    expect(scanFile(UNDERSCORED_RECORD.replace("_guests_", "“guests”"))).toHaveLength(1);
    expect(scanFile(UNDERSCORED_RECORD.replace("_guests_", "'guests'"))).toHaveLength(1);
  });

  /**
   * The apostrophe is stripped only where it flanks a word, and this is the case that decides it:
   * stripping it everywhere turns "New York State's Department of Health" into a string the
   * `(?<!State's )` lookbehind cannot see, and the state department's published attendance
   * threshold is the one false positive this guard has already had.
   */
  it("item 2: stripping the quote marks does not readmit the state department", () => {
    const state =
      'New York State\'s Department of Health publishes a "50 or more attendees" threshold.';
    expect(pairsAgencyWithCount(state)).toBe(false);
    expect(pairsAgencyWithCount("DOHMH's permit turns on the “guest count”.")).toBe(true);
  });

  /**
   * `_` is a WORD CHARACTER, which is why underscore emphasis was worse than asterisk emphasis
   * rather than equal to it. `COUNTED_PEOPLE` anchors its noun list on `\b`, so the emphasis
   * defeated it even wrapping the WHOLE phrase, where the asterisk form was caught all along.
   */
  it("item 1: underscore emphasis around a whole counted phrase is a count", () => {
    const claim = (phrase) => `DOHMH requires a temporary food-service permit above ${phrase}.`;
    expect(pairsAgencyWithCount(claim("_75 or more guests_"))).toBe(true);
    expect(pairsAgencyWithCount(claim("__75 or more guests__"))).toBe(true);
    expect(pairsAgencyWithCount(claim("*75 or more guests*"))).toBe(true);
  });

  it("item 1: flags a struck-through and a linked count phrase", () => {
    // The marker sits INSIDE the phrase, which is what makes the case about the marker: tildes
    // around the whole sentence leave "number of guests" contiguous and were caught all along.
    expect(
      pairsAgencyWithCount("DOHMH keys the permit on the number of ~~guests~~ at intake."),
    ).toBe(true);
    expect(
      pairsAgencyWithCount(
        "DOHMH keys the permit on the number of [guests](https://example.invalid) at intake.",
      ),
    ).toBe(true);
  });

  /**
   * AN EXPECTED COST rather than a design property, and the eighth round measured it before taking
   * it. Stripping `_` normalizes a snake_case identifier: `guest_count` becomes `guestcount`, which
   * `(?:guest) ?count` matches, so a code block naming the agency beside such a field is flagged
   * with no claim in it. It costs nothing on this tree, where the flag set is byte-identical at ten
   * entries with `_` stripped, and it is a live cost the day a field of that name is introduced.
   */
  it("item 1: EXPECTED COST — a snake_case field normalizes into the count vocabulary", () => {
    const block = [
      "// DOHMH publishes the temporary food-service permit for an indoor event.",
      "const guest_count = intake.guests.length;",
    ].join("\n");
    expect(scanFile(block, { bounded: true, allowOptOut: true })).toHaveLength(1);
    // The same block with the field spelled as one word carries no count and is not flagged, so
    // what the case measures is the underscore and nothing else.
    expect(
      scanFile(block.replace("guest_count", "guestTotal"), { bounded: true, allowOptOut: true }),
    ).toEqual([]);
  });

  /**
   * A markdown HARD LINE BREAK is two spaces before the newline, and `docs/DOCUMENTATION-
   * GOVERNANCE.md` line 3 plus four other scanned files carry one. The line break used to be
   * normalized to a space with the two spaces left in front of it, so the phrase read
   * "guest   count" and the expressions join their words with one space. CRLF was the same defect
   * with a different character left behind.
   */
  it("item 1: flags a count phrase split by a markdown hard line break", () => {
    const hardBreak =
      "DOHMH publishes the permit for an indoor event keyed on the guest  \ncount recorded at intake.";
    expect(hardBreak).toContain("guest  \n");
    expect(scanFile(hardBreak)).toHaveLength(1);
  });

  it("item 1: flags a count phrase split by a CRLF line ending", () => {
    const crlf =
      "DOHMH publishes the permit for an indoor event keyed on the guest\r\ncount recorded at intake.";
    expect(scanFile(crlf)).toHaveLength(1);
  });

  /**
   * ITEM 3 of the eighth PR #247 round, in the half that is about the `>` leader. The blockquote
   * alternative in the normalization was undriven: narrowing `(?:\/\/|>)?` to `(?:\/\/)?` left the
   * whole suite green, because nothing exercised a count phrase inside a blockquote continuation.
   * A `>` line is not a bullet or a row to `blocksOf`, so a quoted paragraph is one block and its
   * wrapped continuation carries the leader into the middle of the phrase.
   */
  it("item 3: flags a count phrase wrapped inside a blockquote continuation", () => {
    const quoted = [
      "> DOHMH publishes the temporary food-service permit for an indoor event keyed on the guest",
      "> count recorded at intake.",
    ].join("\n");
    expect(blocksOf(quoted).filter((block) => block.trim() !== "")).toHaveLength(1);
    expect(scanFile(quoted)).toHaveLength(1);
  });

  /**
   * AN EXPECTED MISS, and a structural one rather than a lexical one: `blocksOf` reads a ` * `
   * leader as a list bullet, so every line of a `*`-leader doc comment is its OWN block and there
   * is no wrapped line to rejoin. Each half then fails to be a count on its own ("keyed on 75 or",
   * "more guests recorded at intake"), so the boundary pass has nothing to pair either.
   *
   * Not closed, because the fix is in `blocksOf` rather than in the normalization: a markdown `* `
   * bullet is indistinguishable from a doc-comment line, and every list item being its own block
   * is what the ordinary-English tier of the cross-boundary pass is built on. The same claim on ONE
   * line of a doc comment is flagged, and so is the `//` form above, which is the form
   * `docs/BASELINE.md`'s correction record names in `apps/api/src/rsvps.ts`.
   */
  it("item 1: EXPECTED MISS — a doc comment's `*` leader makes every line its own block", () => {
    const docComment = [
      " * DOHMH publishes the temporary food-service permit for an indoor event keyed on 75 or",
      " * more guests recorded at intake.",
    ].join("\n");
    expect(blocksOf(docComment).filter((block) => block.trim() !== "")).toHaveLength(2);
    expect(scanFile(docComment, { bounded: true, allowOptOut: true })).toEqual([]);
    const oneLine = " * DOHMH publishes the permit for an indoor event of 75 or more guests.";
    expect(scanFile(oneLine, { bounded: true, allowOptOut: true })).toHaveLength(1);
  });

  /**
   * The block KIND is read off the raw block, not off the normalized one. Normalizing strips the
   * emphasis markers, and a ` * ` doc-comment line or a `*` markdown bullet would read as a
   * paragraph without them, which would put the ordinary-English count tier across boundaries the
   * tier deliberately excludes.
   */
  it("item 1: normalizing does not turn a `*` bullet into a paragraph", () => {
    const bullets = [
      " * DOHMH publishes the temporary food-service permit for an indoor event.",
      " * The event expects 75 attendees.",
    ].join("\n");
    expect(scanFile(bullets, { bounded: false, allowOptOut: true })).toEqual([]);
  });

  /**
   * ITEM 3's fourth mutation, closed rather than declared. The noun-first alternation carried an
   * undeclared `{0,40}` window: it could be narrowed to `{0,0}` without failing a single case, and
   * the doc comment advertising "RSVPs exceed 75" never mentioned a distance limit. The window is
   * gone, so the alternation is what its comment says it is, bounded by the sentence.
   */
  it("item 3: the noun-first alternation reaches across a whole sentence", () => {
    const claim =
      "Guests attending an indoor assembly occupancy for which DOHMH publishes the temporary" +
      " food-service permit exceed 75.";
    expect(claim.indexOf("75") - claim.indexOf("Guests")).toBeGreaterThan(40);
    expect(pairsAgencyWithCount(claim)).toBe(true);
  });

  it("item 3: and stops at the sentence, so two sentences are not one count", () => {
    expect(pairsAgencyWithCount("DOHMH counts the guests. Notify the agency 30 days before.")).toBe(
      false,
    );
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
const NOUNS = [
  ["guest", "guest count", "number of guests", "75 or more guests"],
  ["attendee", "attendee count", "number of attendees", "75 or more attendees"],
  ["head", "headcount", "number of heads", "75 or more heads"],
  ["people", "people count", "number of people", "75 or more people"],
  ["person", "person count", "number of persons", "75 persons or more"],
  ["RSVP", "RSVP count", "number of RSVPs", "75 or more RSVPs"],
  ["patron", "patron count", "number of patrons", "75 or more patrons"],
];

describe("the count vocabulary: 7 nouns by 3 phrasings, every cell asserted", () => {
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

  // The `(?:[a-z][a-z-]*,? ){0,2}?` modifier window sits between a phrase's opening and its noun
  // list in BOTH expressions, so each pattern below steps over it explicitly rather than taking the
  // first group it finds. Taking the first group is what a bare `[^)]+` would do, and it would then
  // compare the modifier window's own text against the noun list.
  const MODIFIER_WINDOW = String.raw`\(\?:\[a-z\]\[a-z-\]\*,\? \)\{0,2\}\?`;
  const NOUNS_AFTER = String.raw`\(\?:([^)]+)\)`;

  it("item 1: both expressions declare the same count nouns, in every alternation", () => {
    const declared = [
      [
        "ATTENDEE_COUNT, the outright phrasing",
        nounsIn(ATTENDEE_COUNT_SOURCE, /\(\?:([^)]+)\) \?count/),
      ],
      [
        "ATTENDEE_COUNT, the 'number of' phrasing",
        nounsIn(ATTENDEE_COUNT_SOURCE, new RegExp(`number of ${MODIFIER_WINDOW}${NOUNS_AFTER}`)),
      ],
      [
        "COUNTED_PEOPLE, numeral first",
        nounsIn(
          COUNTED_PEOPLE_SOURCE,
          new RegExp(String.raw`\\\+ \?\)\?${MODIFIER_WINDOW}${NOUNS_AFTER}`),
        ),
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

/**
 * ITEM 2 of the seventh PR #247 review round: the disclosure is DERIVED, not declared. ITEM 2 of
 * the EIGHTH: so is the axis it is derived over. ITEM 1 of the NINTH: so is the CANDIDATE LIST that
 * axis is filtered out of, which is where the previous two rounds still had a hand list.
 *
 * Everything above measures one declaration against another. The grid drives cells someone wrote
 * down; the set equality compares two source strings with each other; the expected misses assert
 * that three named strings are missed. NOTHING measured the declared vocabulary against the shape
 * the artifacts are actually written in, which is how the seventh round's item 1 survived six
 * rounds: "75 or more guests" is a cell of the grid above, and the same words with one newline in
 * them, in a real dated record in `docs/BASELINE.md`, added no flag.
 *
 * The seventh round's corpus fixed half of that and its header said so in words it had not earned.
 * "THE FORMATTINGS ARE THE TREE'S, MEASURED" listed three, and what had actually been measured was
 * line WIDTHS: 4,658 of 11,762 non-blank markdown lines at 90 to 105 characters. The inline MARKERS
 * were remembered ("inline code and bold") and then checked against themselves, so the corpus could
 * only ever exercise the two markers the normalization already stripped. Underscore emphasis,
 * strikethrough and bracketed links were all in the tree and in none of the 1,371 cases.
 *
 * THE EIGHTH ROUND COUNTED THE TREE IN ONE DIRECTION ONLY, and the ninth round's item 1 is that the
 * direction it counted was the one that cannot discover anything. `MARKUP` was a hand list of
 * candidate constructs, `measure()` counted how often each REMEMBERED construct occurs, and the
 * assertion that closed the round compared the surviving list against the list it was filtered out
 * of. Deleting the entry for underscore emphasis, that round's own headline finding at 88 spans in
 * 14 files, left the whole suite green and dropped the construct out of every corpus case. A
 * measurement that can only ever remove a remembered candidate answers "how common is this thing I
 * thought of", never "what is in the tree that nobody thought of".
 *
 * SO THE TREE IS ENUMERATED, AND THE DECLARATION IS CHECKED AGAINST THE ENUMERATION. Two passes over
 * the same roots and extensions the offender scan walks, neither of which reads `MARKUP`:
 *
 *   - `DELIMITERS`: every character that is neither a letter, a digit nor whitespace and that sits
 *     directly against a word. This is the alphabet the tree writes into and around its words.
 *   - `WRAPPERS`: every run of one repeated delimiter that OPENS at a word boundary, closes on the
 *     same line against the same run, and has a span of words between. This is the shape an inline
 *     marker has, found without being named.
 *
 * Every character in the first and every run in the second must then be accounted for: stripped by
 * `normalizeForMatching`, declared as a construct in `MARKUP`, or listed by hand in
 * `EXCLUDED_DELIMITERS` / `EXCLUDED_WRAPPERS` with the reason it is neither. The stripped class is
 * read out of the function by probing it rather than restated, and every character it strips must
 * belong to a declared construct, so the three declarations cannot drift apart in any direction.
 *
 * That is what makes deletion fail. Removing the `MARKUP` entry for underscore emphasis leaves the
 * `_` wrapper enumerated out of the tree and claimed by nothing; removing the entry for links leaves
 * `[` and `]` stripped and claimed by nothing. Both fail here now.
 *
 * WHAT THE ENUMERATION FOUND ON THIS COMMIT that the eighth round's hand list did not:
 *
 *   - QUOTATION MARKS, and they are the most common inline construct in this tree by an order of
 *     magnitude: the wrapper pass counts 1,027 double-quoted spans in 38 .md files and 77
 *     curly-quoted spans in 7, against underscore emphasis at 85 in 12 and strikethrough at 20 in 5.
 *     364 quoted spans in `docs/` and `specs/` wrap a single word, and `docs/BASELINE.md` line 4
 *     writes the struck clause's own subject as "DOHMH thresholds". The record the eighth round
 *     planted, with `_guests_` written `"guests"` instead, walked past the guard for exactly the
 *     same reason `_guests_` did. They are stripped and declared now.
 *   - "bold, underscores" WAS NOT A CONSTRUCT THIS TREE CARRIES. Its detector counted 29 hits in 12
 *     files, and every one of them is `__fixtures__`, the directory: the detector's left edge
 *     allowed a `/` before the marker. Under a wrapper enumeration that requires a word boundary it
 *     occurs zero times, so the entry is removed rather than measured.
 *
 * WHAT IS MEASURED ON THIS COMMIT, occurrences and then files, over every scanned file and then
 * over `.md` alone:
 *
 *     inline code          10,704 / 184   6,615 / 50      bold          2,585 / 60   2,556 / 50
 *     double quotes        16,807 / 220   1,263 / 39      emphasis, *     109 / 33      25 /  9
 *     single quotes           649 /  52      20 /  6      emphasis, _     101 / 17      85 / 12
 *     curly quotes             81 /   9      77 /  7      link             36 / 13      27 /  9
 *     strikethrough            26 /   7      20 /  5
 *
 * 22 of the 72 ordered nested pairs occur and the other 50 are not generated, which is where the
 * measurement changes the corpus rather than confirming it.
 *
 * The two counts the eighth round called its finding, underscore emphasis and strikethrough, are the
 * two RAREST constructs in that table. Rarity is not the point and neither is commonness; being
 * enumerated rather than remembered is.
 *
 * THE WIDTH AXIS IS UNCHANGED and is stated here with its measurement, as before. `.prettierrc`
 * sets `printWidth` 100 and no `proseWrap`, so prose wrapping defaults to `preserve` and is
 * author-controlled; 4,658 of this tree's 11,762 non-blank markdown lines are 90 to 105 characters
 * wide and the median is 95, so the corpus greedy-wraps at 100 and slides the phrase across 60
 * column positions to put the break in every place it can fall.
 *
 * IT IS NOT SAMPLED. The whole cross-product is a few thousand cases of a few regular expressions
 * over short strings, which runs in milliseconds; there is nothing to trade off, so nothing is
 * dropped.
 */
describe("the declared vocabulary, over the formatting the artifacts really use", () => {
  /**
   * The scanned tree, read once. It is walked here rather than imported from
   * `spec-conflict-resolutions.test.mjs`, which has the same walk: importing anything out of a
   * `*.test.mjs` file re-registers that file's suites inside this file's collection, which is the
   * constraint `spec-conflict-scan.mjs`'s header states. It is not moved INTO that module either,
   * because that module is pure by contract and takes every input as a string.
   */
  const scannedTexts = (() => {
    const SKIPPED = new Set(["node_modules", "dist", "coverage", ".next"]);
    const EXTENSIONS = [".md", ".ts", ".tsx", ".mjs", ".js"];
    const matches = (name) => EXTENSIONS.some((extension) => name.endsWith(extension));
    const found = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIPPED.has(entry.name)) continue;
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (matches(entry.name)) found.push(path);
      }
    };
    for (const root of ["docs", "specs", "apps", "packages", "rules", "scripts"])
      walk(resolve(repoRoot, root));
    for (const entry of readdirSync(repoRoot, { withFileTypes: true }))
      if (!entry.isDirectory() && matches(entry.name)) found.push(resolve(repoRoot, entry.name));
    return found.map((path) => ({ prose: path.endsWith(".md"), text: readFileSync(path, "utf8") }));
  })();

  /** A run of one line carrying a letter and none of the delimiters wrapped around it. */
  const SPAN = (chars) =>
    `(?=[^\\n]{0,120}?[A-Za-z])[^\\n${chars.replace(/[\]\\^-]/g, "\\$&")}]{1,120}?`;
  const HREF = "https://example.invalid";

  /**
   * The DECLARED inline constructs. Each carries the wrapper the corpus generates, a detector for
   * the same construct in real text with `@` standing for whatever it wraps, and the delimiter
   * characters it is built out of.
   *
   * The wrapper and the detector are written out separately, which is the shape the eighth round was
   * about, so they are tied together by an assertion rather than by trust: "every declared
   * construct's detector matches its own wrapper" below drives each wrapper through its own
   * detector. The detectors carry the disambiguation a wrapper does not need: `*` must not match the
   * inside of `**`, `_` must not match inside an identifier, and `'` must not match the gap between
   * two apostrophes.
   *
   * THIS LIST IS NO LONGER WHAT DECIDES THE AXIS. It is checked against the tree in both directions
   * by the three assertions below: nothing may be here that the tree does not carry, and nothing may
   * be in the tree that is not here or on an exclusion list.
   */
  const MARKUP = [
    { name: "inline code", wrap: (t) => `\`${t}\``, detect: "`@`", chars: "`" },
    { name: "bold", wrap: (t) => `**${t}**`, detect: "\\*\\*@\\*\\*", chars: "*" },
    {
      name: "emphasis, underscore",
      wrap: (t) => `_${t}_`,
      detect: "(?<![A-Za-z0-9_])_@_(?![A-Za-z0-9_])",
      chars: "_",
    },
    {
      name: "emphasis, asterisk",
      wrap: (t) => `*${t}*`,
      detect: "(?<![*A-Za-z0-9])\\*@\\*(?!\\*)",
      chars: "*",
    },
    { name: "strikethrough", wrap: (t) => `~~${t}~~`, detect: "~~@~~", chars: "~" },
    // The detector stops at the opening parenthesis: the corpus generates one href and the tree
    // carries hundreds, and what is being counted is the bracketed span, not the target.
    { name: "link", wrap: (t) => `[${t}](${HREF})`, detect: "\\[@\\]\\(", chars: "[]" },
    { name: "double quotes", wrap: (t) => `"${t}"`, detect: '"@"', chars: '"' },
    { name: "curly quotes", wrap: (t) => `“${t}”`, detect: "“@”", chars: "“”" },
    {
      name: "single quotes",
      wrap: (t) => `'${t}'`,
      detect: "(?<![A-Za-z0-9])'@'(?![A-Za-z0-9])",
      chars: "'",
    },
  ];

  /**
   * One counting pass over the scanned tree. `each` is handed a file's text and a `count` callback,
   * and reports one key per occurrence; the tally keeps the occurrences and the files separately for
   * every file and for the `.md` files alone.
   */
  const tally = (each) => {
    const counts = new Map();
    for (const { prose, text } of scannedTexts) {
      const seen = new Set();
      each(text, (key) => {
        const entry = counts.get(key) ?? { occurrences: 0, files: 0, prose: 0, proseFiles: 0 };
        entry.occurrences += 1;
        if (prose) entry.prose += 1;
        if (!seen.has(key)) {
          seen.add(key);
          entry.files += 1;
          if (prose) entry.proseFiles += 1;
        }
        counts.set(key, entry);
      });
    }
    return counts;
  };

  /** How many times a construct occurs in the scanned tree, and in how many files. */
  const measure = (detect, chars) => {
    const pattern = new RegExp(detect.replace("@", SPAN(chars)), "g");
    const counted = tally((text, count) => {
      for (let index = 0; index < (text.match(pattern) ?? []).length; index += 1)
        count("construct");
    });
    return counted.get("construct") ?? { occurrences: 0, files: 0, prose: 0, proseFiles: 0 };
  };

  /**
   * EVERY DELIMITER CHARACTER THE TREE WRITES AGAINST A WORD, enumerated out of the tree with no
   * list of any kind in the way: anything that is not a letter, a digit or whitespace, sitting
   * directly beside a letter or a digit. A construct this repository writes and nobody remembered
   * has to be made of characters in here, which is the property a hand list cannot have.
   */
  const ADJACENT_TO_A_WORD = /(?<=[\p{L}\p{N}])[^\p{L}\p{N}\s]|[^\p{L}\p{N}\s](?=[\p{L}\p{N}])/gu;
  const DELIMITERS = tally((text, count) => {
    for (const [character] of text.matchAll(ADJACENT_TO_A_WORD)) count(character);
  });

  /**
   * EVERY WRAPPING CONSTRUCT THE TREE CARRIES, on the same terms: a run of one repeated delimiter
   * that starts at a word boundary, closes against the same run later on the same line, and has a
   * span of words between the two. That is what an inline marker IS, stated structurally instead of
   * by name, so `~~`, `_` and `"` are found by the same pass that finds `` ` `` and nothing has to
   * have been thought of first.
   *
   * The flanking rule is markdown's and is what keeps `a-b-c` and `path/to/file` out: a marker opens
   * at the start of a line or after whitespace or an opening bracket, and closes against the end of
   * a line, whitespace or closing punctuation. A run is at most three characters, which is every
   * marker CommonMark defines, and a span at most 120, which is `PROXIMITY`.
   *
   * It does not find a construct whose two ends DIFFER, which a link and a curly-quoted span both
   * are, and neither does it find an HTML tag pair. Those are caught one level down instead, by the
   * character enumeration above: `[`, `]`, `“`, `”`, `<` and `>` all appear there and all have
   * to be accounted for.
   */
  const escapeRun = (run) => run.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const closers = new Map();
  const closerFor = (run) => {
    if (!closers.has(run)) {
      const marker = escapeRun(run);
      closers.set(
        run,
        new RegExp(
          `^(?!\\s)((?:(?!${marker})[^\\s])(?:(?!${marker}).){0,118}?)(?<!\\s)${marker}(?![^\\s.,;:!?)\\]}])`,
        ),
      );
    }
    return closers.get(run);
  };
  const OPENS_A_RUN = /(?<=^|[\s([{])([^\p{L}\p{N}\s])\1{0,2}(?=\S)/gu;
  const WRAPPERS = tally((text, count) => {
    for (const line of text.split("\n")) {
      for (const opening of line.matchAll(OPENS_A_RUN)) {
        const run = opening[0];
        const closed = line.slice(opening.index + run.length).match(closerFor(run));
        if (closed && /\p{L}/u.test(closed[1])) count(run);
      }
    }
  });

  /**
   * THE CHARACTERS `normalizeForMatching` STRIPS, read out of the function by probing it at the two
   * positions a wrapper occupies rather than restated from its source. A restated class is a second
   * place to forget a character, which is the mistake this whole section is about.
   *
   * The straight apostrophe is stripped only where it flanks a word, so it is in this set and not in
   * the intra-word one: `DOHMH's` and `New York State's Department of Health` keep theirs, and the
   * lookbehind that holds the state department out of the agency expression still sees the string it
   * is written against.
   */
  const strippedBetween = (before, after) => (character) =>
    normalizeForMatching(`${before}${character}${after}`) === `${before}${after}`;
  const STRIPPED = [...DELIMITERS.keys()].filter(
    (character) =>
      strippedBetween("word ", "word")(character) && strippedBetween("word", " word")(character),
  );

  /**
   * The delimiter characters that are deliberately NEITHER stripped nor part of a declared
   * construct, each with the reason and the count that decided it. An exclusion here is a claim that
   * this repository does not use the character to wrap or interrupt a phrase, and the assertion
   * below fails if one of these stops occurring at all, so the list cannot outlive its reasons.
   */
  const EXCLUDED_DELIMITERS = [
    {
      chars: ".,;:!?…–—",
      why:
        "Sentence and clause punctuation, 11,666 periods and 9,876 commas in .md alone. Every" +
        " declared phrase joins its words with single spaces and none of them spans a clause" +
        " boundary; `COUNTED_PEOPLE`'s noun-first alternation deliberately STOPS at a period, so a" +
        " count noun in one sentence and a numeral in the next stay two things. Stripping these" +
        " would join clauses that are not adjacent, which is a claim the scan has no way to check.",
    },
    {
      chars: "-",
      why:
        "The hyphen is a DECLARED MISS with a measured cost, not an oversight: `ATTENDEE_COUNT`" +
        " does not match 'the guest-count threshold', and the one-character fix flags" +
        " `docs/BASELINE.md`'s 'No regulatory fact moves here' paragraph, which DENIES the" +
        " attribution in the tree's own house spelling. Turning it into a space would rewrite" +
        " 'food-service' and '2026-08-07' too. It is generated as a corpus case and asserted to be" +
        " missed, which is the only form of declaration this file accepts.",
    },
    {
      chars: "(){}",
      why:
        "Parentheses and braces bound a clause or a block rather than mark a span of prose: a" +
        " parenthetical is a second statement, not emphasis on the first, and dropping the" +
        " delimiter would join two clauses that were never adjacent. The one parenthesis pair that" +
        " IS removed is a link's `](url)` target, and it is removed as a unit with the bracket it" +
        " belongs to rather than as a character, because there the parentheses carry a URL and not" +
        " a clause.",
    },
    {
      chars: "<>",
      why:
        "HTML and JSX angle brackets. This is the round's own decision on inline HTML tags, and the" +
        " enumeration is what decides it: 64 `<` and 62 `>` sit against a word in 12 .md files, and" +
        " every one of them is a placeholder like `<web-host>` inside a code span or a fat arrow in" +
        " a code sample. The whole tree carries ONE inline HTML tag pair, `<strong>` in README.md," +
        " against 20 strikethrough spans in 5 files, which is the rarest construct that IS" +
        " declared. `<code>guests</code>` would defeat the guard and nothing in this repository" +
        " writes it. If that changes the enumeration will say so, because these two characters are" +
        " counted every run.",
    },
    {
      chars: "/\\=+%$@#|^&",
      why:
        "Operator, path and URL syntax: 4,054 slashes in .md, nearly all of them inside paths and" +
        " links. None wraps a span of prose, and `&` is the opposite of a delimiter here, being a" +
        " literal word in the agency's own spelled-out name, which `CITY_HEALTH_AGENCY` matches as" +
        " written.",
    },
    {
      chars: "§×≥→±⌊⌋",
      why:
        "Typographic and mathematical symbols: the section sign in governance citations (495 in 37" +
        " .md files), and the multiplication, comparison, arrow and floor signs in retry-backoff" +
        " arithmetic and coverage thresholds. Each stands for a word rather than marking one, so a" +
        " phrase never runs through one.",
    },
    {
      chars: "’",
      why:
        "The curly apostrophe, 4 occurrences in one file" +
        " (`docs/proposals/regulatory-scenarios-v2-draft.md`), every one of them a possessive" +
        " inside a word. The curly OPENING quote does not occur in this tree at all, so there is no" +
        " curly single-quoted span to strip, and stripping the closing one alone would break" +
        " possessives the way stripping the straight apostrophe unconditionally would break" +
        " `State's`.",
    },
    {
      chars: "\u0003",
      why:
        'A raw control byte, in `apps/api/src/checklist.test.ts`\'s `Buffer.from("PK\\u0003\\u0004")`:' +
        " the ZIP magic number an upload fixture asserts on. It is a byte in a binary literal" +
        " rather than punctuation in a sentence.",
    },
  ];

  /**
   * The wrapping shapes the enumeration finds that are NOT inline formatting. Every one is balanced
   * ASCII punctuation in a code file that the flanking rule cannot tell apart from a marker.
   *
   * THE COST OF THE NO-DEAD-ENTRY RULE IS STATED RATHER THAN DISCOVERED, because some of these runs
   * occur once: `)))` and `^` are each one expression in one test file. Deleting that expression in
   * an unrelated commit fails the assertion below, and the remedy is deleting the run from this list
   * in the same commit. That is the same bargain `BENIGN_ADJACENT_PAIRS` takes, for the same reason:
   * a list nobody is forced to revisit stops being read.
   */
  const EXCLUDED_WRAPPERS = [
    {
      runs: ["(", ")", "))", ")))", "[", "]", "{", "}"],
      why:
        "An argument list, an array index, a destructuring or an object literal, read as a wrapper" +
        " because the flanking rule sees a run of punctuation on each side of a word. Together they" +
        " account for 5 spans in .md and hundreds in .ts and .mjs. The delimiters are part" +
        " of the code they surround: removing them would rewrite the expression rather than reveal" +
        " a phrase.",
    },
    {
      runs: ["=", "==", "?", "!", ";", ".", "^", "\\", "/", ">"],
      why:
        "Operators, statement terminators and regular-expression syntax in the same position:" +
        " `a === b`, `x?.y`, a `/pattern/` literal, a JSX closing bracket. All but 5 of these spans" +
        " are in code files, and none of the 5 is a marker either: they are table cells and a" +
        " backslash escape.",
    },
  ];

  const MEASURED = MARKUP.map((markup) => ({ ...markup, ...measure(markup.detect, markup.chars) }));

  /**
   * The nested pairs the tree really uses. This is where the measurement changes the corpus rather
   * than confirming it: most of the 72 ordered pairs do not occur and are not generated.
   */
  const COMBINATIONS = MARKUP.flatMap((outer) =>
    MARKUP.filter((inner) => inner !== outer).map((inner) => ({
      name: `${outer.name} of ${inner.name}`,
      wrap: (text) => outer.wrap(inner.wrap(text)),
      ...measure(outer.detect.replace("@", inner.detect), inner.chars),
    })),
  ).filter(({ occurrences }) => occurrences > 0);

  const FORMATTINGS = [...MEASURED, ...COMBINATIONS];

  /** Greedy wrap, never breaking a word: `printWidth` 100 with `proseWrap: preserve`. */
  const wrap = (text, columns = 100) => {
    const lines = [""];
    for (const word of text.split(" ")) {
      const line = lines[lines.length - 1];
      if (line === "") lines[lines.length - 1] = word;
      else if (`${line} ${word}`.length <= columns) lines[lines.length - 1] = `${line} ${word}`;
      else lines.push(word);
    }
    return lines.join("\n");
  };

  /** The claim, with `phrase` as its count half and `lead` sliding it across the column positions. */
  const claim = (phrase, lead = "") =>
    `DOHMH publishes the temporary food-service permit ${lead}for an indoor event keyed on the ` +
    `${phrase} recorded at intake, so raising an RSVP cap moves the permit findings.`;

  /**
   * THE MODIFIER AXIS, which is item 3 of the ninth PR #247 round. `ATTENDEE_COUNT` has taken up to
   * two words of modifier since the eighth round, and the whole feature was driven by three
   * hand-written cells carrying one plain lowercase adjective each: a declaration checked against a
   * declaration, which is the shape round 7's item 2 retired everywhere else in this file. The
   * corpus generates it now, so every modifier runs through every formatting and every wrap
   * position as well.
   *
   * The four are the reviewer's, and three of the four were missed when they were executed against
   * the guard: a hyphenated compound (`(?:[a-z]+ )` rejected the hyphen, so `food-service` and
   * `pre-registered` walked past, and "temporary food-service permit" is the permit this entire
   * guard is about), and a comma between two coordinate adjectives. The modifier goes in front of
   * the count noun itself, which for "75 persons or more" is not the last word of the phrase.
   */
  const MODIFIERS = ["", "confirmed ", "pre-registered ", "food-service ", "confirmed, paying "];

  const nounIn = (phrase, singular) => {
    const word = phrase
      .split(" ")
      .find((candidate) => candidate.toLowerCase().startsWith(singular.toLowerCase()));
    expect(word, `"${phrase}" carries the count noun "${singular}"`).toBeDefined();
    return word;
  };

  const CORPUS = [];
  const add = (formatting, phrasing, text) => CORPUS.push({ formatting, phrasing, text });
  for (const [singular, ...phrasings] of NOUNS) {
    for (const declared of phrasings) {
      const noun = nounIn(declared, singular);
      for (const modifier of MODIFIERS) {
        const phrase = declared.replace(noun, `${modifier}${noun}`);
        add("plain", phrase, claim(phrase));
        for (const { name, wrap: mark } of FORMATTINGS) {
          add(`${name}, whole phrase`, phrase, claim(mark(phrase)));
          add(`${name}, noun`, phrase, claim(phrase.replace(noun, mark(noun))));
        }
        for (let offset = 0; offset < 60; offset += 1) {
          add(
            `wrapped at 100, offset ${offset}`,
            phrase,
            wrap(claim(phrase, `${"x".repeat(offset)} `)),
          );
        }
      }
    }
    // The hyphenated compound exists for the outright phrasing only, and only where that phrasing
    // is two words: nothing writes "number-of-guests", and `headcount` is already one word.
    if (phrasings[0].includes(" ")) {
      add("hyphenated compound", phrasings[0], claim(phrasings[0].replace(" ", "-")));
    }
  }

  /**
   * The generated cases that are NOT caught, which is the disclosure this file used to assert by
   * hand. Every one of them is the hyphenated compound, and it is declared rather than closed
   * because closing it was measured and it costs a false positive on a live correction record:
   * `[ -]?count` in `ATTENDEE_COUNT_SOURCE` flags `docs/BASELINE.md`'s "No regulatory fact moves
   * here" paragraph, which says "no DOHMH rule may key on the attendee-count intake field". That
   * block DENIES the attribution, and the hyphenated compound is this repository's own house
   * spelling for the circumlocution its correction records are written in. The scan reads
   * co-occurrence and not stance, so there is no wording that separates the two.
   */
  const DECLARED_CORPUS_MISSES = NOUNS.map(([, outright]) => outright)
    .filter((outright) => outright.includes(" "))
    .map((outright) => `hyphenated compound: ${outright.replace(" ", "-")}`)
    .sort();

  /**
   * The wrapper and the detector are two statements of one construct, and this is what stops them
   * drifting apart: each declared construct's detector is driven over its own wrapper's output. A
   * detector that stopped recognising its construct would report the construct as absent from the
   * tree, which is the eighth round's defect in a new costume.
   */
  it("item 2: every declared construct's detector matches its own wrapper", () => {
    for (const { name, wrap: mark, detect, chars } of MARKUP) {
      const pattern = new RegExp(detect.replace("@", SPAN(chars)));
      expect(pattern.test(`a ${mark("number of guests")} b`), name).toBe(true);
    }
  });

  /** A count, for a failure message: this is the number that has to be read to decide the case. */
  const withCount = (map) => (key) => {
    const { occurrences, files, prose, proseFiles } = map.get(key);
    return `${JSON.stringify(key)}: ${occurrences} in ${files} files, ${prose} in ${proseFiles} .md`;
  };

  /**
   * ITEM 1 OF THE NINTH ROUND, and the assertion the previous round's could not be. It runs in the
   * direction that can DISCOVER: the tree is enumerated first, and the declaration has to cover what
   * the enumeration found. A wrapping construct this repository writes that is on neither list fails
   * here, and so does deleting the `MARKUP` entry for one it does write.
   *
   * The symmetric run a construct writes is read off its own wrapper rather than declared a third
   * time. A construct whose two ends differ writes no run and claims none: links and curly quotes
   * are covered by the character enumeration below instead.
   */
  const runOf = ({ wrap: mark }) => {
    const [open, close] = mark("@").split("@");
    return open === close ? open : null;
  };

  it("item 1: every wrapping construct the tree carries is a declared one", () => {
    const declared = new Set([
      ...MARKUP.map(runOf).filter((run) => run !== null),
      ...EXCLUDED_WRAPPERS.flatMap(({ runs }) => runs),
    ]);
    expect(
      [...WRAPPERS.keys()]
        .filter((run) => !declared.has(run))
        .map(withCount(WRAPPERS))
        .sort(),
      "a wrapping construct in the tree is declared in MARKUP or excluded with a reason",
    ).toEqual([]);
    for (const run of declared) {
      expect(
        WRAPPERS.get(run)?.occurrences ?? 0,
        `${run} still occurs in the tree`,
      ).toBeGreaterThan(0);
    }
  });

  it("item 1: every delimiter the tree writes against a word is stripped or excluded", () => {
    const declared = new Set([
      ...STRIPPED,
      ...EXCLUDED_DELIMITERS.flatMap(({ chars }) => [...chars]),
    ]);
    expect(
      [...DELIMITERS.keys()]
        .filter((char) => !declared.has(char))
        .map(withCount(DELIMITERS))
        .sort(),
      "a delimiter in the tree is stripped for matching or excluded with a reason",
    ).toEqual([]);
    for (const { chars } of EXCLUDED_DELIMITERS) {
      for (const char of chars) {
        expect(
          DELIMITERS.get(char)?.occurrences ?? 0,
          `${JSON.stringify(char)} still occurs in the tree`,
        ).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The third direction: the stripped class and the declared constructs have to be the same
   * statement. A character the normalizer strips for a construct nobody declares is a construct
   * outside the corpus, and a construct declared for a character the normalizer does not strip is a
   * corpus axis with no normalization behind it.
   */
  it("item 1: the stripped class and the declared constructs are one statement", () => {
    const declared = new Set(MARKUP.flatMap(({ chars }) => [...chars]));
    expect(
      [...STRIPPED].sort(),
      "every stripped character belongs to a declared construct",
    ).toEqual([...STRIPPED].filter((char) => declared.has(char)).sort());
    expect([...declared].sort(), "every declared construct's characters are stripped").toEqual(
      [...declared].filter((char) => STRIPPED.includes(char)).sort(),
    );
  });

  it("item 1: every declared construct is one the tree really carries", () => {
    for (const { name, occurrences, files } of MEASURED) {
      expect(occurrences, `${name} occurs in the scanned tree`).toBeGreaterThan(0);
      expect(files, `${name} occurs in more than one file`).toBeGreaterThan(1);
    }
    expect(COMBINATIONS.length, "some nested pairs occur and most do not").toBeGreaterThan(0);
    expect(COMBINATIONS.length).toBeLessThan(MARKUP.length * (MARKUP.length - 1));
  });

  it("item 2: the corpus is the whole cross-product, unsampled", () => {
    expect(CORPUS).toHaveLength(
      NOUNS.length * 3 * MODIFIERS.length * (1 + 2 * FORMATTINGS.length + 60) + 6,
    );
    expect(
      new Set(CORPUS.map(({ formatting, phrasing }) => `${formatting}|${phrasing}`)).size,
    ).toBe(CORPUS.length);
  });

  it("item 2: exactly the declared misses miss, and everything else is caught", () => {
    const missed = CORPUS.filter(({ text }) => !pairsAgencyWithCount(text)).map(
      ({ formatting, text }) =>
        `${formatting}: ${text.match(/keyed on the ([^,]+) recorded/)?.[1] ?? text}`,
    );
    expect(missed.sort()).toEqual(DECLARED_CORPUS_MISSES);
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
   * The six benign adjacent pairs are the measured price of running the cross-boundary pass
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
 * The phrasings `spec-conflict-resolutions.test.mjs` declares as knowingly uncaught, each asserted
 * to be missed. If a later change starts catching one, this suite fails and the disclosure has to
 * be rewritten in the same commit rather than left standing as an overstatement.
 *
 * THREE HERE IS NOT THE WHOLE DISCLOSURE, and the seventh PR #247 round's item 2 is why it used to
 * read as though it were. These three are outside the declared count vocabulary, so no corpus over
 * that vocabulary can generate them and they have to be named. The misses INSIDE the vocabulary are
 * not named: they are derived, in "the declared vocabulary, over the formatting the artifacts
 * really use" above, and the structural one is asserted where it arises. A fourth phrasing inside
 * the vocabulary quietly stopping being caught fails there, which is the failure this list could
 * never have.
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

  /**
   * A FOURTH declared miss, decided in the ninth PR #247 round rather than left unstated. The
   * numeral is what makes a count noun a threshold in `COUNTED_PEOPLE`, and a spelled-out numeral
   * carries no digit. It is declared rather than closed on the enumeration's own terms: the scanned
   * tree contains zero instances of a spelled-out count, and a word list of number names would be
   * the denylist shape this guard has already had removed from it once.
   */
  it("misses a spelled-out numeral, which carries no digit", () => {
    expect(pairsAgencyWithCount("DOHMH requires a permit at seventy-five or more guests.")).toBe(
      false,
    );
  });
});
