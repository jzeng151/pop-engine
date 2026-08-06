import { createHash } from "node:crypto";

/**
 * The mechanism behind `spec-conflict-resolutions.test.mjs`'s DOHMH/headcount scan: the block
 * splitter, the regular expressions, the pairing predicate, the per-file scan and the pin digest.
 *
 * WHY IT IS A MODULE RATHER THAN LOCALS OF THE SUITE. `vitest.config.ts` lines 27-29 states the
 * house standard: "a guard with no test proves only that it does not false-positive on a good
 * tree. Nothing proved it still FAILS on a bad one until its suite existed." The suite next door
 * only ever observes this repository, where nothing is wrong, so every predicate below was
 * unproven against a bad input until `spec-conflict-resolutions.fixtures.test.mjs` existed. That
 * file imports these names and drives them over positive and negative strings. Importing them out
 * of a `*.test.mjs` file is not an option: the import would re-register that file's suites inside
 * the fixture file's collection.
 *
 * Everything here is pure and takes its input as a string. The file walk, the ruleset parsing and
 * every assertion stay in the suite, which is what the fixtures cannot substitute for.
 */

/**
 * The city agency, by acronym, by its spelled-out name, by the brand the health department
 * publishes under, and by the two generic forms.
 *
 * The generic forms exclude New York STATE's department, which publishes a real attendance
 * threshold that `docs/VERIFICATION-SOURCES.md` quotes. The exclusion covers the POSSESSIVE
 * as well as the plain form: an earlier `(?<!State )` saw "ate's " in "New York State's
 * Department of Health" and flagged that true published fact as a fabricated claim.
 */
export const CITY_HEALTH_AGENCY_SOURCE =
  "\\bDOHMH\\b|\\bDepartment of Health and Mental Hygiene\\b|\\bNYC Health\\b" +
  "|(?<!State |State's |SDOH )\\b(?:Department of Health|Health Department)\\b";
export const CITY_HEALTH_AGENCY = new RegExp(CITY_HEALTH_AGENCY_SOURCE, "i");

/** Phrases that name an attendee count outright, including the published intake field. */
export const ATTENDEE_COUNT_SOURCE =
  "head ?count|guest ?count|attendee ?count|attendance|crowd size|party size" +
  "|number of (?:guests|attendees|people)";
export const ATTENDEE_COUNT = new RegExp(ATTENDEE_COUNT_SOURCE, "i");

/**
 * A counted quantity of people: "75 or more guests", "above 75 attendees", "RSVPs exceed 75".
 *
 * These nouns are ordinary English and appear all over a repository about events, so unlike the
 * phrases above they are not a count on their own. The NUMERAL is what makes one a threshold,
 * and it is required in either order. "ONE person signed in THREE capacities" and "the guest
 * list" carry no numeral and are not counts; "500 or more people" is one.
 */
export const COUNTED_PEOPLE_SOURCE =
  "\\b\\d{1,6} ?(?:or more |or fewer |\\+ ?)?(?:guests|attendees|people|RSVPs|patrons)\\b" +
  "|\\b(?:guests|attendees|people|RSVPs|patrons)\\b[^.\\n]{0,40}?(?<![\\w-])\\d{1,6}(?![\\w-])";
export const COUNTED_PEOPLE = new RegExp(COUNTED_PEOPLE_SOURCE, "i");

/**
 * How far apart the agency and the count may sit and still be read as one claim.
 *
 * This bound applies where the two are in DIFFERENT blocks, and inside one block only in the file
 * kinds `BOUNDED_EXTENSIONS` names. See `pairsAgencyWithCount` for why those are not the same.
 */
export const PROXIMITY = 120;

/** The agency and `source` within `PROXIMITY` characters of each other, in either order. */
const agencyNear = (source) =>
  new RegExp(
    `(?:${CITY_HEALTH_AGENCY_SOURCE})[\\s\\S]{0,${PROXIMITY}}?(?:${source})` +
      `|(?:${source})[\\s\\S]{0,${PROXIMITY}}?(?:${CITY_HEALTH_AGENCY_SOURCE})`,
    "i",
  );
export const AGENCY_NEAR_COUNTED_PEOPLE = agencyNear(COUNTED_PEOPLE_SOURCE);
export const AGENCY_NEAR_ATTENDEE_COUNT = agencyNear(ATTENDEE_COUNT_SOURCE);
export const AGENCY_NEAR_ANY_COUNT = agencyNear(
  `${ATTENDEE_COUNT_SOURCE}|${COUNTED_PEOPLE_SOURCE}`,
);

/**
 * The file kinds where the distance bound also applies INSIDE a block, and the only kinds where
 * the opt-out marker below is honoured. Both privileges belong to code and to nothing else.
 *
 * The distance bound was applied everywhere until the fourth PR #247 review round, and that made
 * the check effectively SENTENCE-level for the `guests / attendees / people / RSVPs / patrons`
 * vocabulary: a claim stated across two sentences of one paragraph, the ordinary shape of a dated
 * decision record in this repository, sat more than 120 characters apart and passed. Prose is
 * therefore unbounded within a block now (one paragraph is one authored unit), and the bound is
 * kept for code, where a case table or a fixture array can put an unrelated agency string and an
 * unrelated headcount hundreds of characters apart in one block with no claim between them.
 *
 * One block in this tree relies on that: `packages/engine/src/acceptance.test.ts`'s
 * `CONF-NO-FOOD-001` case, which carries the DOHMH citation label and a headcount in one array
 * literal. It is the ONLY block in the tree that pairs the agency with counted people beyond 120
 * characters, measured over the whole tree rather than assumed, and it stays unflagged.
 */
export const BOUNDED_EXTENSIONS = [".ts", ".tsx"];

/**
 * The opt-out a source file may take, honoured in `BOUNDED_EXTENSIONS` files and NOWHERE else.
 *
 * It exists because the corrected fact could not otherwise be given a regression test. The one
 * executable proof that DOHMH findings are invariant under `headcount` has to name the agency and
 * vary the count, which is the co-occurrence this scan flags; the scan reads co-occurrence and not
 * stance, and `headcount` is the literal field name in the intake type, so the "F-101 intake
 * field" circumlocution the prose records use is unavailable in code.
 *
 * It is deliberately NOT available in `.md`. Prose cannot opt out: a document that wants to
 * discuss the struck clause either writes around the pairing or is pinned as a historical record,
 * and both of those are visible. A marker in a source file is visible in the same way, and it
 * carries an obligation a reader can check: the block it marks must actually assert the
 * independence, not merely mention it.
 */
export const OPT_OUT_MARKER = "guard: asserts-independence";

/** Paragraphs, list items and table rows. A block ends where the next one begins. */
export const blocksOf = (text) => {
  const blocks = [""];
  for (const line of text.split("\n")) {
    if (line.trim() === "" || /^[\s/*#-]*([-*+]\s|\d+\.\s|\|)/.test(line)) blocks.push(line);
    else blocks[blocks.length - 1] += `\n${line}`;
  }
  return blocks;
};

/** Whether a block is a prose paragraph rather than a list item or a table row. */
export const isParagraph = (block) =>
  !/^[\s/*#-]*([-*+]\s|\d+\.\s|\|)/.test(block.trim().split("\n")[0] ?? "");

/**
 * Whether one block pairs the city health agency with an attendee count.
 *
 * `bounded` is what `BOUNDED_EXTENSIONS` decides. The `ATTENDEE_COUNT` half is unbounded either
 * way: those phrases name a count outright, so a block carrying one and the agency is putting the
 * two in the same authored unit wherever they sit in it.
 */
export const pairsAgencyWithCount = (text, { bounded = false } = {}) =>
  CITY_HEALTH_AGENCY.test(text) &&
  (ATTENDEE_COUNT.test(text) || (bounded ? AGENCY_NEAR_COUNTED_PEOPLE : COUNTED_PEOPLE).test(text));

/**
 * Every block of one file that pairs the city health agency with an attendee count, within one
 * block or ACROSS THE BOUNDARY between two adjacent blocks.
 *
 * Both sites this defect has actually taken were one block, but the reviewer's split injection put
 * the agency in one block and the count in the next and walked past a block-only scan.
 *
 * THE CROSS-BOUNDARY PASS HAS TWO TIERS, and which one applies is decided by the count vocabulary
 * rather than by the block kind:
 *
 *   - `ATTENDEE_COUNT` ("headcount", "guest count", "attendance", "number of guests") pairs
 *     across the boundary between blocks of ANY kind. These phrases name the count as a concept,
 *     so an adjacent block naming the agency is the claim however the two are laid out.
 *   - `COUNTED_PEOPLE` ("20 attendees", "RSVPs exceed 75") pairs across the boundary only
 *     between two PARAGRAPHS. Those nouns are ordinary English in a repository about events, and a
 *     numeral beside one in a NEIGHBOURING REGISTER ENTRY is usually a different agency's
 *     published fact rather than a claim about this one.
 *
 * Both tiers used to be paragraph-only, and the third PR #247 round's own comment named "a
 * register table row" as one of the two historical sites while that filter excluded every table
 * row and list item: the claim split across two adjacent register rows, or two adjacent bullets,
 * or a paragraph and the bullet under it, went past. The fourth round's decided remedy was to drop
 * the paragraph filter outright and let `PROXIMITY` bound both tiers, on the reading that rows and
 * bullets are short so the false-positive cost would be small. Measured on this tree rather than
 * predicted, that cost is one false positive and it is on a source of record:
 * `docs/VERIFICATION-SOURCES.md` items 8 and 9 are adjacent numbered entries, the first recording
 * Parks' own published "more than 20 attendees" threshold and the second recording DOHMH's
 * organizer obligations, 121 characters apart. Two separate published facts, no claim between
 * them, and exactly the case the previous round's comment cited as the reason for the filter.
 *
 * So the filter is dropped for the tier that carries the shapes the round found and kept for the
 * tier that produces the false positive. That is strictly wider than the paragraph-only version in
 * both tiers combined: nothing that used to be flagged stops being flagged.
 */
export function scanFile(text, { bounded = false, allowOptOut = false } = {}) {
  const optedOut = (block) => allowOptOut && block.includes(OPT_OUT_MARKER);
  // Empty blocks are dropped so that ADJACENT means "nothing between them but whitespace". A
  // paragraph followed by a blank line and then a bullet produces an empty block in between, and
  // that is the third of the structural shapes the fourth PR #247 round found: with the empty
  // block counted, the paragraph's neighbour was the blank line and the bullet was never paired
  // with it. A block that separates two others still separates them; a blank line never did.
  const blocks = blocksOf(text).filter((block) => block.trim() !== "");
  const flagged = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const next = blocks[index + 1];
    if (optedOut(block)) continue;
    if (pairsAgencyWithCount(block, { bounded })) {
      flagged.push(block);
    } else if (next !== undefined && !optedOut(next) && !pairsAgencyWithCount(next, { bounded })) {
      const pair = `${block}\n${next}`;
      const acrossAnyBlocks = AGENCY_NEAR_ATTENDEE_COUNT.test(pair);
      const acrossParagraphs =
        isParagraph(block) && isParagraph(next) && AGENCY_NEAR_ANY_COUNT.test(pair);
      if (acrossAnyBlocks || acrossParagraphs) flagged.push(pair);
    }
  }
  return flagged;
}

/**
 * A register table row, with the two things a neighbouring edit moves normalized away: the row
 * number, and the intra-cell padding.
 *
 * The row number, because the register renumbered this row twice while the decision was open (it
 * was T-5, then T-6) and the `#209` test in the suite already establishes the issue link as the
 * identifier that does not move.
 *
 * The padding, because a markdown table pads EVERY cell to the width of the longest cell in its
 * column, so an edit to any other row re-pads this one. That is not a hypothetical: base commit
 * 0f13294 on `pr/retire-second-party-review` lengthened T-4's cell and re-aligned the table, which
 * changed bytes in 11 register rows and grew this row's resolution cell by 208 spaces without
 * changing one word. Digesting that would report the register's own protected approval record as a
 * live fabricated regulatory claim, on a commit that touched no word of it.
 *
 * Runs of two or more spaces are collapsed across the whole row, not just in the ID cell: every
 * cell is re-padded, not only the one that was renumbered. A single space is left alone, so
 * ordinary wording still lands inside the digest.
 */
export const stableRegisterRow = (block) =>
  block.replace(/\bT-\d+ */g, "T-# ").replace(/ {2,}\|/g, " |");

/**
 * The FOUR recorded approvals that carry the struck clause, pinned by the SHA-256 of the block
 * they sit in. `docs/BASELINE.md`'s 2026-08-05 correction record is the live statement about all
 * four; these blocks are the historical text that record corrects.
 *
 * They are here because `docs/DOCUMENTATION-GOVERNANCE.md` §6 line 103 says an approval recorded
 * in named capacities under the rules then in force stays on the record IN THE WORDS IT WAS
 * GIVEN. An earlier pass struck the clause out of these four records instead, which left git
 * history as the only evidence that a fabricated regulatory claim had ever been inside an
 * approved decision. So the words are restored and the correction is a separate dated record.
 *
 * A CONTENT PIN RATHER THAN A SKIP, deliberately. "Do not look at this block" would let the same
 * pass that struck the clause strike it again silently. A digest asserts the opposite: this exact
 * text is PRESENT and UNCHANGED. That is §6 line 103 enforced mechanically instead of by
 * convention, and it is why the pin is worth more than the exemption it costs.
 *
 * EXACTLY FOUR, and a fifth is a governance action, not a way to silence this guard. Adding an
 * entry means asserting that some other block is a recorded approval whose wording §6 protects.
 * If a NEW block trips the scan, the answer is almost always that the claim is live and must be
 * removed, not that the pin set should grow. The clause also sat in three code comments, in
 * `apps/api/src/rsvps.ts` and `apps/api/src/rsvps.test.ts`; those were removed in place and are
 * deliberately NOT pinned, because §6 protects an approval and not a comment.
 *
 * An anchor identifies ONE record, so it has to be a string only that record carries. The register
 * row's anchor was `SPEC-CONFLICT #209` until the fourth PR #247 round, and that is the identifier
 * the suite's own `#209` test tells contributors to cite: any new row citing the issue matched the
 * anchor and failed the exactly-once assertion, reporting a duplicated approval record when
 * nothing protected had been touched. It now anchors on the row's own subject line.
 */
export const HISTORICAL_RECORDS = [
  {
    file: "docs/BASELINE.md",
    record: "Decision 2026-08-03 (T-6 / SPEC-CONFLICT #209, resolved)",
    anchor: "**Decision 2026-08-03 (T-6 / SPEC-CONFLICT #209, resolved):**",
    sha256: "4118a1943655984eceaf6683c7d409d10a795dfa7a6b1a7dbcf9a59678c546e4",
  },
  {
    file: "docs/BASELINE.md",
    record: "Decision 2026-08-05 (product owner, issue #236, F-302 rollout compatibility window)",
    anchor: "**Decision 2026-08-05 (product owner, issue #236, F-302 rollout compatibility",
    sha256: "02c17a95da7c4cb2d9f7db69a1a78b8be9a224af533f4d81ce78800d2ea2d638",
  },
  {
    file: "docs/OPEN-QUESTIONS.md",
    record: "the register row recording the 2026-08-03 SPEC-CONFLICT #209 resolution",
    anchor: "F-302 and F-306 admission-limit source ([SPEC-CONFLICT #209]",
    stable: stableRegisterRow,
    sha256: "147286c64cd54bd1be68d1b0f962fd4047598e07388e0279d72cbde2f10df23e",
  },
  {
    file: "specs/F-302-rsvp-guest-list.md",
    record: "Acceptance Criterion 2's rationale paragraph",
    anchor: "Admission was F-101 `headcount` until this amendment.",
    sha256: "361115ca04bae942a53671e7fe35f3503987f0cb867c2f8aede9071004300776",
  },
];

/** The text a pin protects: the whole block, minus any part the pin declares unstable. */
export const pinnedDigest = (pin, block) =>
  createHash("sha256")
    .update(pin.stable ? pin.stable(block) : block, "utf8")
    .digest("hex");
