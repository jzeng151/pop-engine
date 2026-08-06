import { describe, expect, it } from "vitest";
import {
  BOUNDED_EXTENSIONS,
  HISTORICAL_RECORDS,
  OPT_OUT_MARKER,
  PROXIMITY,
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
 * Every case below is a STRING, so it says what the guard does rather than what this tree happens
 * to contain. Each of the four defects that round found has a case here that FAILED before its
 * fix and passes after, and each names the defect it stands for.
 *
 * The two knowingly-uncaught phrasings are here too, as EXPECTED MISSES. They are asserted to be
 * missed, so a later change that starts catching one of them fails this suite and forces the
 * disclosure in `spec-conflict-resolutions.test.mjs` to be brought back into line. A disclosure
 * that is only prose drifts; this is the part of it a test can hold.
 */

const CLAIM = "DOHMH requires a temporary food-service permit";

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
   * ITEM 3 of the fourth PR #247 round. The distance bound was applied everywhere, so for the
   * `guests / attendees / people / RSVPs / patrons` vocabulary the check was effectively
   * SENTENCE-level: this fixture is the ordinary shape of a dated decision record in this
   * repository, and it passed. Compressed under `PROXIMITY` characters it fired, which is what
   * made the gap look like a bound on the claim rather than on the sentence.
   */
  const TWO_SENTENCE_RECORD = [
    "**Decision 2026-08-07 (product owner, F-101 intake):** DOHMH's temporary food-service permit is the",
    "gate on public pop-up events that serve prepared food from a shared table. The threshold agreed with",
    "the vendor lane is 75 or more guests, and the intake form now captures it.",
  ].join("\n");

  it("item 3: flags a claim stated across two sentences of one prose block", () => {
    expect(
      TWO_SENTENCE_RECORD.indexOf("75 or more guests") - TWO_SENTENCE_RECORD.indexOf("DOHMH"),
    ).toBeGreaterThan(PROXIMITY);
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

describe("scanFile: the cross-boundary pass", () => {
  /**
   * ITEM 2 of the fourth PR #247 round. The cross-boundary pass required both blocks to be
   * PARAGRAPHS, and a table row and a list item are both non-paragraphs, so the claim split across
   * two adjacent register rows went past. This is the executed fixture from that round, verbatim.
   */
  const TWO_REGISTER_ROWS = [
    "| T-9  | headcount semantics | Product owner | **RESOLVED 2026-08-07:** F-101 `headcount` is a regulatory input. |",
    "| T-10 | what it drives      | Product owner | **RESOLVED 2026-08-07:** it drives the DOHMH thresholds. |",
  ].join("\n");

  const TWO_BULLETS = [
    "- F-101 `headcount` is a regulatory input, recorded at intake.",
    "- It drives the DOHMH thresholds.",
  ].join("\n");

  const PARAGRAPH_THEN_BULLET = [
    "F-101 `headcount` is a regulatory input, recorded at intake.",
    "",
    "- It drives the DOHMH thresholds.",
  ].join("\n");

  it("item 2: flags the claim split across two adjacent register rows", () => {
    expect(scanFile(TWO_REGISTER_ROWS)).toHaveLength(1);
  });

  it("item 2: flags the claim split across two adjacent bullets", () => {
    expect(scanFile(TWO_BULLETS)).toHaveLength(1);
  });

  it("item 2: flags the claim split between a paragraph and the bullet under it", () => {
    expect(scanFile(PARAGRAPH_THEN_BULLET)).toHaveLength(1);
  });

  it("still flags the claim split across two adjacent paragraphs", () => {
    const split = `The DOHMH permit is the gate here.\n\nThe intake captures 75 or more guests.`;
    expect(scanFile(split)).toHaveLength(1);
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
   * the filter. These are `docs/VERIFICATION-SOURCES.md` items 8 and 9 in miniature: two adjacent
   * register entries, the first recording Parks' own published threshold and the second recording
   * a DOHMH obligation. Two published facts, no claim between them.
   */
  it("does not pair a neighbouring register entry's Parks threshold with a DOHMH entry", () => {
    const register = [
      '8. **Parks threshold**: portal: "a permit for any event with more than 20 attendees".',
      "9. **DOHMH organizer obligations**: the sponsor submits a participating-vendor list.",
    ].join("\n");
    expect(scanFile(register)).toEqual([]);
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
