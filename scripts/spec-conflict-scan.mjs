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

/**
 * Phrases that name an attendee count outright, including the published intake field.
 *
 * The noun list is the SAME list `COUNTED_PEOPLE` declares, run through both phrasings this
 * repository uses ("the guest count", "the number of guests"). It was not, until the fifth PR #247
 * review round: `RSVPs` and `patrons` were declared count nouns in `COUNTED_PEOPLE` and appeared in
 * neither phrasing here, `head` appeared in one, and `people` and `person` were partial. So "the
 * RSVP count is a regulatory input driving the DOHMH thresholds", which is the pinned register
 * row's own sentence with one noun swapped, was missed by this expression and missed by
 * `COUNTED_PEOPLE` too, which requires a numeral those phrasings do not carry. That was a gap
 * INSIDE the declared vocabulary rather than one of the two declared misses. The 7-noun by
 * 2-phrasing grid is written out in `spec-conflict-resolutions.fixtures.test.mjs` and asserted
 * cell by cell, so a noun cannot be added to one expression and forgotten in the other again.
 */
export const ATTENDEE_COUNT_SOURCE =
  "(?:head|guest|attendee|people|person|rsvp|patron) ?count" +
  "|attendance|crowd size|party size" +
  "|number of (?:guests|attendees|people|persons|heads|RSVPs|patrons)";
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
 * IT APPLIES IN CODE AND NOWHERE ELSE, as of the fifth PR #247 review round: inside a block in the
 * file kinds `BOUNDED_EXTENSIONS` names, and across a block boundary in those same file kinds.
 *
 * It used to bound the cross-boundary pass in every file kind, and MEASURED OVER THE CONCATENATED
 * PAIR, which is what made that pass dead code on this tree. The real prettier-aligned register
 * rows in `docs/OPEN-QUESTIONS.md` are 4940 characters wide; the minimum agency-to-count separation
 * across each adjacent pair of the 11 real rows runs 1496, 2398, 3500, 3578, 3899, 3954, 4329,
 * 4336, 4651 and 4662 characters, against a budget of 120. `docs/BASELINE.md`'s dated records have
 * a median length of 989 characters and 3 of 39 are under 120. Instrumented over every scanned
 * root, the pass produced 41 single-block flags and ZERO cross-boundary pairs: it had never fired.
 * The fixture that certified it was the one fixture in the suite not built from the artifact it
 * stood for, two hand-written register rows about 110 characters long.
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
 * The code files the bound does NOT apply in, in-block or across a boundary, whatever their
 * extension.
 *
 * `docs/BASELINE.md`'s 2026-08-05 correction record says of the three code comments that carried
 * the struck clause, two in `apps/api/src/rsvps.ts` and one in `apps/api/src/rsvps.test.ts`, that
 * "it is removed in place and stays removed". The bound let it back into exactly those files: the
 * fifth PR #247 review round planted the clause into `apps/api/src/rsvps.ts` as an ordinary
 * three-line `//` comment spread over two sentences and the whole suite stayed green, while the
 * byte-identical text in a `.md` file failed. A bound that readmits the clause to the files a
 * correction record says it stays out of is not a bound worth having there.
 *
 * The bound is kept everywhere else in code, for the measured reason `BOUNDED_EXTENSIONS` gives.
 * This list is the narrow exception, and it is a list of files rather than a rule because the
 * record is about those files. Adding to it means asserting that some other file is one a
 * correction record removed the clause from in place.
 */
export const UNBOUNDED_RECORD_FILES = ["apps/api/src/rsvps.ts", "apps/api/src/rsvps.test.ts"];

/**
 * The file kinds where the opt-out marker below is honoured: every scanned CODE extension.
 *
 * Not the same list as `BOUNDED_EXTENSIONS`, and the fifth PR #247 review round is why. The two
 * were one list, so a new guard fixture under `scripts/*.mjs` was scanned with the marker inert:
 * a five-line `scripts/new-guard.test.mjs` carrying the marker and one DOHMH/headcount sentence
 * failed twice over, once as an unpinned offender and once for carrying a marker "honoured in .ts
 * and .tsx files only", leaving its author no remedy but a fourth entry in `GUARD_SOURCES`, which
 * `spec-conflict-resolutions.test.mjs` calls a governance action rather than a fix. Dropping
 * `.mjs` and `.js` from the scan was the alternative and is worse: it would take `scripts/` back
 * out of the guard's reach, which is the hole closed on 2026-08-05. So the marker is honoured in
 * them instead. The bound is a separate question and is answered separately: these files are
 * scanned unbounded, like prose, because nothing measured says otherwise.
 */
export const OPT_OUT_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

/**
 * The opt-out a source file may take, honoured in `OPT_OUT_EXTENSIONS` files and NOWHERE else.
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
 * bullets are short so the false-positive cost would be small.
 *
 * THAT READING WAS WRONG ABOUT THIS TREE AND THE FIFTH ROUND MEASURED IT. Rows and bullets here are
 * not short: with `PROXIMITY` measured over the concatenated pair, the pass never fired once on any
 * scanned root. It is therefore dropped outright IN PROSE, and kept in `BOUNDED_EXTENSIONS` files
 * for the same measured reason it is kept inside a block there. Both halves of that are measured
 * over the whole tree rather than predicted:
 *
 *   - Dropping it in prose costs FOUR false positives, all adjacent pairs of unrelated true
 *     statements, and they are named and pinned in `BENIGN_ADJACENT_PAIRS` below with the reason
 *     each is two facts rather than one claim. `docs/VERIFICATION-SOURCES.md` items 8 and 9, the
 *     candidate the fourth round named at 121 characters apart, is NOT among them: it is two
 *     numbered list items, so it is the ordinary-English tier, which the paragraph filter still
 *     excludes. That false positive was avoided by one character under the old bound and is
 *     avoided structurally now.
 *   - Dropping it in code as well would cost EIGHT more, seven adjacent pairs of `describe` and
 *     `it` blocks in `packages/engine/src/acceptance.test.ts` and one in `apps/api/src/plan.test.ts`,
 *     which is the same shape the in-block bound exists for: a fixture array or a case table puts
 *     an unrelated agency string and an unrelated headcount far apart with no claim between them,
 *     and an adjacent pair of them does it twice over. So the bound stays in code, minus the files
 *     `UNBOUNDED_RECORD_FILES` names.
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
      const agency = CITY_HEALTH_AGENCY.test(pair);
      const acrossAnyBlocks = bounded
        ? AGENCY_NEAR_ATTENDEE_COUNT.test(pair)
        : agency && ATTENDEE_COUNT.test(pair);
      const acrossParagraphs =
        isParagraph(block) &&
        isParagraph(next) &&
        (bounded
          ? AGENCY_NEAR_ANY_COUNT.test(pair)
          : agency && (ATTENDEE_COUNT.test(pair) || COUNTED_PEOPLE.test(pair)));
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

/**
 * THE MEASURED FALSE-POSITIVE COST of running the cross-boundary pass unbounded in prose: four
 * adjacent pairs, each two unrelated true statements that happen to sit next to each other.
 *
 * They are a DIFFERENT KIND OF ENTRY from `HISTORICAL_RECORDS` and the difference matters. A
 * historical record is text that DOES carry the struck clause and is protected from editing by
 * governance §6. A benign pair carries no claim at all: neither block says the agency reads the
 * count, and the scan flags them because it reads co-occurrence and not stance, across a boundary
 * it now reads unbounded. Nothing here is protected wording; each entry is this round saying "we
 * looked at these two blocks and they are two facts, not one claim", with the reason written down.
 *
 * PINNED BY DIGEST RATHER THAN LISTED BY FILE, for the same reason the historical records are: an
 * allowlist by file would let the claim be written into one of these blocks later and go
 * unreported. The digest covers both blocks, so any wording change to either one breaks the pin
 * and the pair has to be read again. THE COST OF THAT IS REAL AND IS STATED RATHER THAN HIDDEN:
 * these are live documents, and an ordinary edit to one of these blocks fails the guard until the
 * digest is recomputed in the same commit. That is the price of running the pass at all, and the
 * pass was worth nothing at all until this round.
 *
 * The suite asserts each entry still matches exactly one flagged pair, so an entry that stops
 * being needed fails rather than sitting here forever as an unexamined exemption.
 */
export const BENIGN_ADJACENT_PAIRS = [
  {
    file: "docs/ARCHITECTURE.md",
    pair: "the intake schema table's Scale + date row and its Audience + food row",
    anchor: "| Scale + date ",
    stable: stableRegisterRow,
    sha256: "0b6b6cd069dd1dec441b60833afc0d28f7e061f04bb9d75d4145a81a66e7f504",
    why:
      "Two rows of the intake field inventory. The first names `headcount` as a column and says in" +
      " terms that it is a regulatory input only; the second says which fields drive the DOHMH" +
      " vendor and notification rules, and `headcount` is not among them. Read together they" +
      " CONTRADICT the struck clause rather than state it.",
  },
  {
    file: "docs/BASELINE.md",
    pair: "the 2026-08-05 correction record's 'What the ruleset publishes instead' and 'Which triggers actually read the field' paragraphs",
    anchor: "**What the ruleset publishes instead.**",
    sha256: "58e2516fdc30f6a5008fead79d7af8f875597528fb2ceea3958f8cba294142cb",
    why:
      "The two paragraphs of the correction record that state the corrected fact. The first lists" +
      " what the three DOHMH rules key on; the second lists the four rules that do read" +
      " `headcount` and names their agencies, none of which is DOHMH. This is the record that" +
      " struck the clause, and the pairing is the record doing its job.",
  },
  {
    file: "docs/BASELINE.md",
    pair: "the correction record's 'No regulatory fact moves here' paragraph and the 2026-08-05 PRD Parks threshold decision under it",
    anchor: "**No regulatory fact moves here.**",
    sha256: "525b9f006f47d236ab53486a6ca807154e8903e3e10d437bea20b7544da73e29",
    why:
      "Two dated records that share a boundary and nothing else. The first names DOHMH while" +
      " describing what this guard checks; the second is the Parks special event permit threshold," +
      " a published Parks fact about guests that names no health agency. Two records, two agencies.",
  },
  {
    file: "specs/F-201-permit-plan-generator.md",
    pair: "acceptance criteria 8 and 9",
    anchor: "8. All boundary fixtures pass: park headcount 19/20/21;",
    sha256: "4889e0a488b8223ebab91c42347b2d00ea8fdd86416b72dbe2985aee1ac09756",
    why:
      "Criterion 8 lists the boundary fixtures, of which `park headcount 19/20/21` is the Parks" +
      " threshold; criterion 9 lists Scenario A's rescopes, one of which lands on the DOHMH" +
      " notification. Adjacent items of one enumeration, each about a different rule.",
  },
];

/** The text a pin protects: the whole block, minus any part the pin declares unstable. */
export const pinnedDigest = (pin, block) =>
  createHash("sha256")
    .update(pin.stable ? pin.stable(block) : block, "utf8")
    .digest("hex");
