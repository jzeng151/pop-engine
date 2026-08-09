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
 *
 * THE POSSESSIVE IS SPELLED TWO WAYS AND BOTH ARE EXCLUDED, which is the eleventh PR #247 round.
 * Only the straight apostrophe was listed, and `normalizeForMatching` strips neither spelling
 * between two letters, so "New York State’s Department of Health requires this for 75 attendees"
 * fell through to the generic "Department of Health" alternative and reported the STATE
 * department's own published threshold as an invented city claim. The curly apostrophe is not an
 * edge case in pasted or word-processed source text, and the tree already carries four of them, in
 * `docs/proposals/regulatory-scenarios-v2-draft.md`, all four possessive. The comment above
 * promised the state department was excluded, so the promise is what is made true rather than
 * narrowed. `normalizeForMatching` strips the curly QUOTATION marks and deliberately leaves the
 * curly apostrophe alone, for the same reason it leaves a flanked straight one alone: stripping it
 * would turn this string into one no lookbehind can see.
 *
 * The spelled-out name takes an AMPERSAND, added in the sixth PR #247 round, and the agency renders
 * its own name both ways.
 *
 * IT ALSO TOOK "Department of" AS AN OPTIONAL PREFIX, and the eighth round's item 3 removed it as
 * dead. The alternation is unanchored, so any string containing "Department of Health and Mental
 * Hygiene" also contains "Health and Mental Hygiene" and matched without it. The one thing an
 * optional prefix can still do is start the match EARLIER, which matters inside `claimSubject`'s
 * window in `BOUNDED_EXTENSIONS` files, and it could not do that either: the generic form below
 * matches the bare "Department of Health" at that same position. The one input where the two
 * differ is "New York State's Department of Health and Mental Hygiene", where the lookbehind blocks
 * the generic form and the prefix would have widened the window around the STATE department, which
 * is the agency this expression is shaped to keep out. The fixture that stood for it asserted on a
 * string that matched identically either way, so its name promised what its assertion could not
 * distinguish; it names the ampersand alone now.
 *
 * A bare `DOH` was the other candidate and is deliberately NOT here. It appears nowhere in this
 * tree, so there is no house style to match, and in a regulatory sentence it reads as the STATE
 * department at least as often as the city one, which is the agency the lookbehind above exists to
 * keep out. Matching it would mean flagging the true SDOH attendance threshold on an acronym alone.
 */
export const CITY_HEALTH_AGENCY_SOURCE =
  "\\bDOHMH\\b|\\bHealth (?:and|&) Mental Hygiene\\b|\\bNYC Health\\b" +
  "|(?<!State |State's |State’s |SDOH )\\b(?:Department of Health|Health Department)\\b";
export const CITY_HEALTH_AGENCY = new RegExp(CITY_HEALTH_AGENCY_SOURCE, "i");

/**
 * Phrases that name an attendee count outright, including the published intake field.
 *
 * The noun list is the SAME list `COUNTED_PEOPLE` declares, run through both phrasings this
 * repository uses ("the guest count", "the number of guests"). It was not, in either direction,
 * and both directions were found by hand rather than by a test.
 *
 * The fifth PR #247 review round found it one way round: `RSVPs` and `patrons` were declared count
 * nouns in `COUNTED_PEOPLE` and appeared in neither phrasing here, `head` appeared in one, and
 * `people` and `person` were partial. So "the RSVP count is a regulatory input driving the DOHMH
 * thresholds", the pinned register row's own sentence with one noun swapped, was missed here and
 * missed by `COUNTED_PEOPLE` too, which requires a numeral those phrasings do not carry.
 *
 * The sixth round found the other way round, because fixing one direction is not checking the
 * other: `persons` and `heads` were declared here and missing from BOTH alternatives of
 * `COUNTED_PEOPLE`. So "DOHMH requires a temporary food-service permit for indoor assembly
 * occupancies used by 75 persons or more" passed while the same sentence ending "75 or more guests"
 * failed, on one noun swapped between two spellings this file declares as the same vocabulary. That
 * phrasing is the BUILDING CODE'S OWN: `rules/nyc-rules.v2.11.json` quotes BC 303.7's "used or
 * intended for use by 75 persons or more" in the published rule the sentence is about.
 *
 * Both were gaps INSIDE the declared vocabulary rather than either of the declared misses, and the
 * anti-drift test did not hold because it was one-sided: the grid's claim strings carried no
 * numeral, so `COUNTED_PEOPLE` could never fire in any of its cells. It is 7 nouns by THREE
 * phrasings now, the third carrying the numeral, and the two noun lists are additionally asserted
 * EQUAL AS SETS, derived from these two source strings rather than restated. Adding a noun to one
 * expression and forgetting it in the other fails that assertion whether or not the grid grew.
 *
 * `attendance`, `crowd size` and `party size` are outside that equality, being phrasings rather
 * than nouns, and the seventh round found that two of the three were driven by nothing: deleting
 * `crowd size` and `party size` left all 79 cases green, as did deleting `NYC Health` from the
 * agency expression. All three are driven now.
 *
 * THE "number of" PHRASING TAKES UP TO TWO WORDS OF MODIFIER, which the eighth PR #247 round added.
 * "the number of confirmed guests" is one adjective away from the declared phrase and missed, close
 * enough that a reader would expect it caught while the disclosure's paraphrase bullet technically
 * covered it. The cost was measured rather than assumed: the widened alternation matches NOTHING in
 * the scanned roots that the narrow one did not, so no text in this tree turns on it, and the flag
 * set is unchanged at ten. What it buys in exchange is a real reading cost, stated here: two
 * arbitrary words between "number of" and a count noun are read as one phrase, so a future sentence
 * like "the number of open questions people have raised" beside an agency mention is a false
 * positive this alternation, and not the author, created.
 *
 * THE MODIFIER IS A WORD, NOT A RUN OF `[a-z]`, which is the ninth round's item 3. `(?:[a-z]+ )`
 * rejected a hyphen and a comma, so "the number of pre-registered guests", "the number of
 * food-service attendees" and "the number of confirmed, paying guests" were all missed while "the
 * number of confirmed guests" was caught. `food-service` is the compound in the permit's own name,
 * "temporary food-service permit", which is the sentence this whole guard exists about, and
 * `docs/PRD.md` already writes `capacity-aware RSVPs`. The window is `(?:[a-z][a-z-]*,? )` now: a
 * word may carry internal hyphens and may end in the comma that separates two coordinate
 * adjectives. THE SAME WINDOW IS IN `COUNTED_PEOPLE`'s numeral-first alternation below, because "75
 * or more confirmed guests" was the same miss in the other vocabulary. Nothing drove any of this
 * before: the corpus generated NO MODIFIERS AT ALL and the feature was held up by three hand-written
 * cells with plain lowercase adjectives, which is one declaration checked against another. The
 * modifier is a generated corpus axis now, run through every formatting and every wrap position.
 *
 * THE HYPHENATED COMPOUND IS A DECLARED MISS: "the guest-count threshold" is not matched, and the
 * one-character fix for it (`[ -]?count`) was measured and rejected. It flags `docs/BASELINE.md`'s
 * "No regulatory fact moves here" paragraph, which says "no DOHMH rule may key on the
 * attendee-count intake field". That block DENIES the attribution, and the hyphenated compound is
 * this repository's house spelling inside the very circumlocution its correction records are
 * written in. The scan reads co-occurrence and not stance, so the cost is not avoidable by wording.
 */
export const ATTENDEE_COUNT_SOURCE =
  "(?:head|guest|attendee|people|person|rsvp|patron) ?count" +
  "|attendance|crowd size|party size" +
  "|number of (?:[a-z][a-z-]*,? ){0,2}?(?:guests|attendees|people|persons|heads|RSVPs|patrons)";
export const ATTENDEE_COUNT = new RegExp(ATTENDEE_COUNT_SOURCE, "i");

/**
 * A counted quantity of people: "75 or more guests", "above 75 attendees", "RSVPs exceed 75".
 *
 * These nouns are ordinary English and appear all over a repository about events, so unlike the
 * phrases above they are not a count on their own. The NUMERAL is what makes one a threshold,
 * and it is required in either order. "ONE person signed in THREE capacities" and "the guest
 * list" carry no numeral and are not counts; "500 or more people" is one. A SPELLED-OUT numeral is
 * therefore a declared miss: "seventy-five or more guests" carries no digit, the tree contains zero
 * instances of it, and it is asserted as an expected miss next door rather than left to be found.
 *
 * The numeral-first alternation takes the same two words of modifier `ATTENDEE_COUNT` takes, added
 * in the ninth round for "75 or more confirmed guests". Its cost is the mirror of that one and is
 * stated the same way: two arbitrary words between the numeral and the noun are read as one phrase,
 * so "75 days before guests arrive" beside an agency mention is a false positive this window
 * created. The flag set on this tree is unchanged at ten with it.
 *
 * THE NUMERAL-FIRST NOUN MAY BE SINGULAR, which is the eleventh PR #247 round. Every noun in both
 * alternations was plural, so a threshold of one was missed on its grammar alone: "DOHMH requires a
 * permit when 1 guest attends", "when 1 attendee registers" and "when 1 person attends" were all
 * counts nobody could state, in either expression, and the published-output audit rests on the same
 * predicate. The plural `s` is optional here rather than a second alternation, so the noun list
 * stays one list and cannot drift from the other three (the set equality next door canonicalizes
 * the two spellings to one word). Its cost, measured over every scanned root: the flag set is
 * unchanged at ten, and the widened form matches nothing in this tree the plural form did not.
 *
 * THE NUMERAL IS THE SAME NUMERAL IN BOTH ALTERNATIONS, which the singular forced and which was an
 * inconsistency before it. The noun-first half has always refused a numeral attached to a word or a
 * hyphen (`(?<![\w-])\d{1,6}(?![\w-])`, so "2026-08-07" is a date and not a threshold) and the
 * numeral-first half took a bare `\b\d{1,6}`. With plural nouns only, the difference was invisible.
 * With the singular, "DOHMH-VENDOR-PERMIT-001 covers every guest" reads its own rule id as "1
 * guest": this repository writes rule ids ending in digits beside the agency name constantly, so
 * the singular is only affordable with the same guard the other half already carries.
 *
 * THE NOUN-FIRST ALTERNATION KEEPS ITS PLURALS, and that is a decision rather than an omission.
 * That half reaches to the end of the sentence, so a singular there would read "a guest" against
 * any numeral later in the sentence: "a guest asked about the 75th day" beside an agency mention.
 * A threshold of one written noun-first ("no guest may attend unless 1 ...") is not English anyone
 * writes, so the miss it leaves is not a shape a claim can take.
 *
 * THE NOUN-FIRST ALTERNATION REACHES TO THE END OF THE SENTENCE, and nothing narrower. It carried
 * a `{0,40}` character window until the seventh PR #247 review round, which found that window
 * UNTESTED and UNDECLARED: it could be narrowed to `{0,0}` with all 79 cases green, while the
 * comment above advertised "RSVPs exceed 75" without mentioning any distance limit at all. So
 * "Guests attending an indoor assembly occupancy for which DOHMH publishes the temporary
 * food-service permit exceed 75" went past on the distance alone. The window is removed rather than
 * widened and declared, because removing it was measured over every scanned root and changed no
 * flag on this tree. The sentence remains the bound: the class excludes a period, so a count noun
 * in one sentence and a numeral in the next are still two things, and it excludes the other two
 * ordinary sentence terminators and the semicolon for the same reason `sentencesOf` splits at
 * them. The semicolon joined that class in the nineteenth round, with the boundary itself: a noun
 * in one independent clause and a numeral in the next are two things on the same reading.
 *
 * THE HYPHENATED ADJECTIVAL FORM IS A THIRD ALTERNATION, which is the fourteenth PR #247 round.
 * Both halves refuse a numeral touching a hyphen, which is what keeps "2026-08-07" a date and
 * "DOHMH-VENDOR-PERMIT-001" a rule id rather than a threshold. That guard also refused the
 * repository's own house phrasing: `docs/PRD.md` and the proposal prose already write "75-person"
 * and "90-person", so "DOHMH requires a permit for a 75-person event" stated a city health
 * threshold that neither expression matched. The hyphen is admitted only when the very next token
 * is one of the counted-person nouns, so nothing a date or a rule id can look like is admitted
 * with it: both put digits or an uncounted word after the hyphen, not "guest" or "person".
 *
 * A THOUSANDS SEPARATOR IS PART OF THE NUMERAL, which is the fifteenth PR #247 round. The numeral
 * was `\d{1,6}` with a `(?<![\w-])` guard, and a comma is neither a word character nor a hyphen, so
 * "1,075 guests" matched on its SUFFIX: the phrase came out as "075 guests" and `claimedCounts`
 * read it as 75. On a rule legitimately published at 75, an output claim of 1,075 was therefore
 * licensed by the rule's own threshold, which is a materially different organizer-facing number
 * borrowed from a real one. The numeral is `NUMERAL_BODY` now, one token that either carries its
 * groups or carries none, and the guard refuses a digit run that FOLLOWS a `digit,` seam so no
 * suffix of a grouped number can be read as a number of its own.
 *
 * Its cost is stated the way the other widenings here are: a comma-separated list written with no
 * space after the comma ("20,50,75 guests") has a last member preceded by `digit,`, so it is no
 * longer read as a count. That shape appears nowhere in this tree, the spaced form ("20, 50, 75
 * guests") is unaffected, and the flag set over every scanned root is unchanged.
 */
const COUNTED_PERSON_NOUN = "(?:guest|attendee|people|person|head|RSVP|patron)s?";
/** One count numeral, with or without its thousands separators. */
export const NUMERAL_BODY = "(?:\\d{1,3}(?:,\\d{3})+|\\d{1,6})";
/** The same numeral, refusing a word, a hyphen or the tail of a grouped number on either side. */
const COUNT_NUMERAL = `(?<![\\w-])(?<!\\d,)${NUMERAL_BODY}(?![\\w-])`;

/**
 * How far the NOUN-FIRST alternation below reaches forward for its numeral. The twenty-first PR
 * #247 round, and a performance bound rather than a reading of English.
 *
 * The reach was the rest of the sentence, so a block carrying count nouns and no numeral made the
 * engine rescan the suffix from every noun: `pairsAgencyWithCount` over "DOHMH " and a repeated
 * "guests word " cost 56ms at 4,000 repetitions, 226ms at 8,000 and 922ms at 16,000 on this tree's
 * Node, which is the doubling-time-quadruples signature `joinWrappedLines` already carries a fix
 * for. Both suites walk every tracked prose block, so one generated record or changelog long enough
 * would overrun Vitest's per-test limit and fail changes that have nothing to do with this guard.
 * That is not hypothetical here: table padding in `docs/BASELINE.md` did exactly that once.
 *
 * WHY A BOUND RATHER THAN A REWRITE. The linear form of this question is "find the numerals once,
 * then look back for a noun", and this expression is not only used through `test`: `claimSubject`
 * builds proximity windows out of its SOURCE, so the span it matches is measured. A bounded lazy
 * gap is linear in the block (201 attempts per noun, each O(1)) and leaves the matched span exactly
 * what it was.
 *
 * 200 IS MEASURED AND NOT CHOSEN. Over every scanned root, this alternation matches 70 times and
 * the longest gap between the noun and its numeral is 188 characters, in a sentence of this guard's
 * own prose; the longest in anything claim-shaped is 109. So the bound changes no match on this
 * tree, which was checked by diffing the whole flag set across the change rather than by argument.
 * The cost is stated: a count noun and its numeral more than 200 characters apart in one sentence
 * are no longer one phrase. The other two alternations are unbounded, so a numeral-first claim of
 * any length is unaffected.
 */
export const COUNT_PHRASE_REACH = 200;
export const COUNTED_PEOPLE_SOURCE =
  `${COUNT_NUMERAL} ?(?:or more |or fewer |\\+ ?)?(?:[a-z][a-z-]*,? ){0,2}?${COUNTED_PERSON_NOUN}\\b` +
  `|(?<![\\w-])(?<!\\d,)${NUMERAL_BODY}-${COUNTED_PERSON_NOUN}\\b` +
  `|\\b(?:guests|attendees|people|persons|heads|RSVPs|patrons)\\b` +
  `[^.!?;\\n]{0,${COUNT_PHRASE_REACH}}?${COUNT_NUMERAL}`;
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
export const BOUNDED_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

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
export const OPT_OUT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".js"];

/**
 * EVERY EXTENSION THIS GUARD READS AS PROSE, declared once for both suites.
 *
 * It was a local of `spec-conflict-resolutions.test.mjs` and a near-copy of it was a local of
 * `spec-conflict-resolutions.fixtures.test.mjs`: two lists that
 * have to agree and nothing that makes them, which is the eighteenth PR #247 round. Neither suite
 * can import the other's (importing out of
 * a `*.test.mjs` file re-registers its suites), so the shared declaration lives here, beside the
 * two extension lists that already decide how a path is scanned. A list of extensions is a
 * declaration and not a file walk, so it costs this module nothing of the purity its header states.
 *
 * THE TYPESCRIPT MODULE EXTENSIONS ARE HERE, which is the same round's other item. The list read
 * `.md`, `.ts`, `.tsx`, `.mjs` and `.js`, so `scripts/spec-conflict-scan.d.mts`, the declaration
 * file this branch introduced, was outside every prose assertion this guard makes; regulatory prose
 * written into it, or into any future `.mts` or `.cts` module, was read by nobody. The tracked-file
 * coverage assertion filtered on this same list, so it stayed green over the hole rather than
 * naming it, which is why `spec-conflict-resolutions.test.mjs` now classifies every tracked
 * extension instead of filtering by this one.
 *
 * `.mts` and `.cts` are TypeScript, so they are in `BOUNDED_EXTENSIONS` and `OPT_OUT_EXTENSIONS`
 * on the same terms `.ts` is: the distance bound applies inside their blocks, and their authors
 * have the opt-out a `.ts` author has.
 *
 * `.html` IS PROSE, which is the twenty-first PR #247 round, and the exemption that used to keep it
 * out is now the path list below. A whole extension classified as an agency's published words is an
 * exemption far wider than the eight captures that justify it: a repository-authored page such as
 * `apps/web/public/permit-help.html` could state a city health trigger and be read by neither the
 * walk nor the assertion about the walk, because the coverage partition accepts any extension the
 * non-prose map names. Rendered HTML is prose an organizer reads, so the default is to scan it.
 */
export const PROSE_EXTENSIONS = [".md", ".html", ".ts", ".tsx", ".mts", ".cts", ".mjs", ".js"];

/**
 * THE CAPTURED AGENCY SOURCE PAGES, by path, and the one exemption `.html` gets.
 *
 * `docs/proposals/<capture>/<name>.page.html` is a saved nyc.gov page: an agency's OWN published
 * words, which AGENTS.md's authority order puts ABOVE this repository's prose. A threshold quoted
 * there is a primary source, and reporting one as a fabricated regulatory claim would be this guard
 * contradicting the order it exists to enforce. Everything else with an `.html` extension is a page
 * this repository wrote, and it is scanned like any other prose.
 *
 * IT IS A PATH RULE AND IT NAMES THE CAPTURE CONVENTION rather than the eight files: a refetch
 * lands a new dated directory of `.page.html` files, and enumerating today's eight would leave
 * tomorrow's capture reported as this repository's own invented claim on the day it lands. A page
 * this repository authors is not written under `docs/proposals/` with that suffix.
 *
 * Measured: the eight captures on this tree produce ZERO flags if they are scanned, so this
 * exemption moves nothing today. It is a decision about what a FUTURE capture means, which is why
 * it is worth stating rather than leaving to the extension list.
 *
 * Declared here rather than in either suite for the reason `PROSE_EXTENSIONS` is: both suites walk
 * the tree, neither can import the other, and a skip that disagrees between them is a file one
 * reads and the other does not.
 */
export const CAPTURED_SOURCE_PAGES = /^docs\/proposals\/[^/]+\/[^/]+\.page\.html$/;

/** Whether a repository-relative path is one of the captured agency source pages. */
export const isCapturedSourcePage = (relative) => CAPTURED_SOURCE_PAGES.test(relative);

/**
 * The directories a prose walk does NOT descend into: `.git`, and the four build and dependency
 * directories `.gitignore` already keeps out of version control. Everything else under the
 * repository root is walked, whatever its name.
 *
 * Declared here for the same reason `PROSE_EXTENSIONS` is: both suites walk the tree, neither can
 * import the other, and a skip list that disagrees between them is a file one of them reads and the
 * other does not. THE LIST IS NOT TRUSTED by either: `spec-conflict-resolutions.test.mjs` reads the
 * tracked set out of git and fails if anything skipped here turns out to hold a file the repository
 * actually carries.
 */
export const SKIPPED_DIRS = [".git", "node_modules", "dist", "coverage", ".next"];

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
 *
 * THE MARKER ALONE NO LONGER SUPPRESSES ANYTHING, which is the tenth PR #247 round. Until this
 * round the obligation in the paragraph above was carried by nobody: `block.includes(marker)` asked
 * whether a block DECLARES that it asserts the independence and never whether it does, so a future
 * comment could restore the struck clause beside the marker, or the regression test could lose its
 * assertions and keep it, and this guard stayed green either way. That is the shape this branch has
 * spent nine rounds removing everywhere else, an exemption that trusts a declaration. The marker is
 * a NECESSARY condition now and `INDEPENDENCE_ASSERTIONS` below is the sufficient one.
 */
export const OPT_OUT_MARKER = "guard: asserts-independence";

/**
 * The blocks the marker actually exempts: pinned by file and by the SHA-256 of the block, the same
 * way `HISTORICAL_RECORDS` is pinned, and for the same reason. A digest asserts what a marker
 * cannot: this exact block, in this file, is the one whose author took on the obligation, and its
 * assertions are still the assertions that were read.
 *
 * BOTH FAILURE MODES THE MARKER LEFT OPEN CLOSE ON THE DIGEST. Restoring the struck clause to the
 * marked comment changes the block, so the digest stops matching and the claim is reported. Deleting
 * the `expect` calls that make it a regression test changes the same block, because the marked
 * comment and the `describe` it introduces are ONE block: no blank line separates them, and
 * `blocksOf` ends a block only where the next one begins. That is what makes the pin worth more here
 * than a file allowlist, which would have closed the copy and neither of these.
 *
 * ONE ENTRY, and a second is a governance action rather than a way to quiet the guard, exactly as a
 * fifth `HISTORICAL_RECORDS` pin is. Adding one means asserting that some other block is the
 * executable proof that DOHMH findings are invariant under the count. THE COST IS REAL AND IS
 * STATED: this is a live test file, so an ordinary edit inside the marked block fails the guard
 * until the digest is recomputed in the same commit. That is the price of the exemption being
 * checked instead of declared, and the exemption was worth nothing checked-by-declaration.
 */
export const INDEPENDENCE_ASSERTIONS = [
  {
    file: "apps/api/src/rsvps.test.ts",
    block: 'the "DOHMH findings do not move with headcount (#235)" regression test',
    anchor: 'describe("DOHMH findings do not move with headcount (#235)"',
    sha256: "318191ff727d1cd83d805c270f275f2c2f299b1e430e914436b4494cfcf1ac81",
  },
];

/**
 * The two options `scanFile` takes, for one repository-relative path.
 *
 * They answer two independent questions and are therefore derived from two lists. It lives here,
 * rather than inline in the caller that walks the tree, because of the sixth PR #247 review round's
 * item 2: both of the fifth round's fixes were single clauses inside a function local to
 * `spec-conflict-resolutions.test.mjs`, nothing drove the selection, and reverting either one left
 * the whole suite green. A selection that is a function of a path can be driven over a table of
 * paths, which is what `spec-conflict-resolutions.fixtures.test.mjs` now does.
 */
export const scanOptionsFor = (relative) => ({
  bounded:
    BOUNDED_EXTENSIONS.some((extension) => relative.endsWith(extension)) &&
    !UNBOUNDED_RECORD_FILES.includes(relative),
  allowOptOut: OPT_OUT_EXTENSIONS.some((extension) => relative.endsWith(extension)),
  // Which blocks of this file the marker may exempt. A file with no pin gets an empty list, so the
  // marker is inert in it and its author is told so rather than silently trusted.
  optOutDigests: INDEPENDENCE_ASSERTIONS.filter((pin) => pin.file === relative).map(
    (pin) => pin.sha256,
  ),
});

const isHorizontalSpace = (character) => character === " " || character === "\t";

/** A line with the whitespace that sat before its line break removed, the CR included. */
const withoutTrailingSpace = (line) => {
  let end = line.length;
  if (end > 0 && line[end - 1] === "\r") end -= 1;
  while (end > 0 && isHorizontalSpace(line[end - 1])) end -= 1;
  return line.slice(0, end);
};

/** A continuation line with its indentation and its one comment or blockquote leader removed. */
const withoutLeader = (line) => {
  let start = 0;
  while (start < line.length && isHorizontalSpace(line[start])) start += 1;
  if (line.startsWith("//", start)) start += 2;
  else if (line[start] === ">") start += 1;
  while (start < line.length && isHorizontalSpace(line[start])) start += 1;
  return line.slice(start);
};

/**
 * Every line break of a text, with the whitespace and the one comment or blockquote leader around
 * it, collapsed to a single space. This is the last step of `normalizeForMatching` below, which
 * states what each part of it is for.
 *
 * IT IS A SCAN RATHER THAN THE ONE GLOBAL REGEX IT REPLACES, `[ \t]*\r?\n[ \t]*(?:\/\/|>)?[ \t]*`,
 * and that is a MEASURED performance fix rather than a style preference. That regex is quadratic in
 * the length of a run of spaces: the leading `[ \t]*` matches the whole run from every position
 * inside it and then backtracks one character at a time when no line break follows. A table pads
 * every cell to the width of its column, so `docs/BASELINE.md` carries 84 runs of 100 spaces or
 * more and its longest is 8,633; the sum of the squares of its runs is 2.4 billion. Timed on one
 * synthetic run of spaces, the regex costs 0.6ms at 1,000 characters, 2.0ms at 2,000, 7.9ms at
 * 4,000 and 31.3ms at 8,000, which is the doubling-time-quadruples signature.
 *
 * What that cost on this tree: scanning `docs/BASELINE.md` alone took 2,880ms of the whole tree's
 * 3,232ms, and `spec-conflict-resolutions.test.mjs` walks the tree twice, so CI's 5-second per-test
 * limit was overrun by a file's table padding. The scan is unchanged in what it matches: the
 * equivalence to the regex was checked character-for-character over every block of every scanned
 * file before the regex was removed.
 */
export const joinWrappedLines = (text) => {
  const lines = text.split("\n");
  const last = lines.length - 1;
  return lines
    .map((line, index) => {
      const body = index === 0 ? line : withoutLeader(line);
      return index === last ? body : withoutTrailingSpace(body);
    })
    .join(" ");
};

/**
 * One block's text as one line of prose, for MATCHING ONLY. Never for a digest: every pin reads
 * the raw block, so nothing here can widen or narrow what a pin protects.
 *
 * THE SEVENTH PR #247 REVIEW ROUND'S ITEM 1. Every expression above joins its words with a literal
 * single space, `blocksOf` below reassembles a hard-wrapped paragraph into one block ON PURPOSE,
 * and nothing between the two put the wrapped line back together. So this dated record, planted in
 * the real `docs/BASELINE.md` and wrapped the way this tree's markdown is wrapped, added no flag:
 *
 *     **Decision 2026-08-07 (product owner, issue #248, DOHMH indoor assembly threshold):** the
 *     temporary food-service permit and the organizer notification DOHMH publishes for an indoor
 *     event keyed on 75 or more guests recorded at intake, so raising an RSVP cap moves the permit
 *     findings.
 *
 * The reachability is ordinary rather than adversarial. `.prettierrc` sets no `proseWrap`, so it
 * takes prettier's default of `preserve` and every wrap in this tree is where its author left it,
 * unreflowed; 4,658 of this tree's 11,762 non-blank markdown lines are 90 to 105 characters wide,
 * against a `printWidth` of 100. Sweeping the declared count phrases across 60 column positions of
 * a sentence wrapped at 100 defeated the guard in 365 of 1440 positions, and defeats it in 0 of
 * 1440 now. The two sites this defect has actually taken both stated the count as `headcount`, a
 * single word no wrap can split, which is why it was never seen here.
 *
 * `spec-conflict-resolutions.test.mjs` lines 126-128 record the same repair, in the same file, on
 * the #207 guard: it "read physical lines instead, so a bullet wrapped onto a continuation naming
 * F-213 sat outside the filter."
 *
 * THE INLINE MARKERS WERE HALF THE SET UNTIL THE EIGHTH ROUND, which is that round's item 1. This
 * stripped `` ` `` and `*` and named them "the emphasis and inline-code markers"; one of markdown's
 * two emphasis markers is an asterisk and the other is an underscore, and the underscore is the one
 * this tree writes. Measured over the scanned roots, underscore emphasis appears 88 times in 14
 * files and strikethrough 21 times in 6, including the pinned register row itself. So this record,
 * planted as the newest one in the real `docs/BASELINE.md`, added no flag, while the same record
 * with the two underscores removed added one:
 *
 *     **Decision 2026-08-07 (product owner, issue #248, DOHMH indoor assembly threshold):** the
 *     temporary food-service permit and the organizer notification DOHMH publishes for an indoor
 *     event are keyed on the number of _guests_ recorded at intake, not on the vendor count, so
 *     raising an RSVP cap moves the permit findings.
 *
 * `_` is a WORD CHARACTER, which is what made the underscore worse than the asterisk rather than
 * equal to it: `COUNTED_PEOPLE`'s noun list is `\b`-anchored, so `_75 or more guests_` failed to be
 * a count at all even with the emphasis wrapping the whole phrase. Every one of the seven nouns
 * missed that way. `~~strikethrough~~` and a bracketed link's `[` and `]` failed for the plainer
 * reason that the marker sits inside the phrase: "the number of [guests](url)" is not the literal
 * "number of guests" that `ATTENDEE_COUNT` joins with a single space.
 *
 * THE MARKER SET IS NOT REMEMBERED ANY MORE, which is the NINTH round's item 1 and the reason
 * quotation marks are in it. Every character stripped here is checked against an enumeration of the
 * delimiters this tree actually writes against its words, in
 * `spec-conflict-resolutions.fixtures.test.mjs`: a wrapping construct the repository carries that
 * is neither stripped here nor declared there fails that suite, and so does deleting a declaration
 * for one it does carry. The eighth round's list was a hand list checked against itself, and the
 * construct it did not think of was the commonest one in the tree.
 *
 * SEVEN THINGS ARE NORMALIZED, each because a phrasing was measured to walk past without it:
 *
 *   - The inline-code marker, so "the number of `guests`" reads as the words it wraps. This
 *     repository writes `headcount` in backticks throughout, so it is the house style rather than
 *     an edge case.
 *   - BOTH emphasis markers, the strikethrough marker and a link's brackets: `*`, `_`, `~`, `[` and
 *     `]`, so "the number of **guests**", "the number of _guests_", "~~the number of guests~~" and
 *     "the number of [guests](url)" all read as the words they wrap.
 *   - A LINK'S TARGET, `](url)`, which the eighth round left alone on the reading that "the count
 *     phrase ends at the closing bracket". That is true only where the linked word ends the phrase.
 *     The corpus generates the link over the noun of every phrasing, and "the [guest](url) count"
 *     is the case that reading missed: the target sits INSIDE the phrase, between the two words
 *     `ATTENDEE_COUNT` joins with a single space. The round-8 cell that stood for this wrapped the
 *     last word of the phrase, which for "guest count" is "count", so it asserted the case that
 *     works. The destination is removed by COUNTING its parentheses rather than by stopping at the
 *     first one, which is the seventeenth round and is stated at `withoutLinkTargets` below.
 *     Parentheses OUTSIDE a destination are still left alone: a parenthetical is a second clause,
 *     and dropping its delimiters would join two clauses that are not adjacent.
 *   - QUOTATION MARKS: `"`, `“` and `”` always, and the straight apostrophe only where it flanks a
 *     word. This is the ninth round's item 2 and it is byte-for-byte the eighth round's defect with
 *     `_guests_` written `"guests"`: quoted spans are the most common inline construct in this
 *     tree, 1,027 of them in 38 .md files against 85 underscore-emphasis spans in 12, and 364 of
 *     them wrap a single word. The apostrophe's condition is not decoration: stripping it
 *     unconditionally turns `DOHMH's` into `DOHMHs`, which `\bDOHMH\b` does not match, and turns
 *     "New York State's Department of Health" into a string the `(?<!State's )` lookbehind no
 *     longer sees, which would flag the STATE department's real published threshold. That is the
 *     one false positive this guard has already had.
 *   - The line break, to a single space, with any surrounding indentation. The TRAILING half is
 *     what closes markdown's hard line break, two spaces before a newline, which four scanned files
 *     carry, `docs/DOCUMENTATION-GOVERNANCE.md` line 3 among them: it used to normalize to a triple
 *     space and miss. `\r?` closes CRLF the same way. Neither is a shape a real author writes
 *     mid-phrase, which is why the reviewer who found them did not rank them; they are closed
 *     because they cost two characters each and the flag set did not move.
 *   - The comment leader that follows a line break, so a `//` comment wrapped over two lines is one
 *     line of prose too. The scan reads `.ts`, `.tsx`, `.mjs` and `.js`.
 *   - The `>` blockquote leader that follows a line break, for the same reason in markdown.
 *
 * THE COST OF STRIPPING `_` IS STATED RATHER THAN LEFT TO BE DISCOVERED: a snake_case identifier
 * like `guest_count` normalizes to `guestcount`, which `(?:guest) ?count` matches, so a code block
 * naming the agency and such a field would be flagged with no claim in it. It costs nothing today,
 * measured: the flag set on the clean tree is byte-identical at ten entries with `_` and `~` added.
 * It is a live cost if a field of that name is ever introduced. The quotation marks carry the same
 * kind of cost and the same measurement: a code block naming the agency beside the string literal
 * `"guest count"` reads as the phrase, and the flag set on the clean tree is the same ten entries
 * with `"`, `“`, `”`, the conditional `'` and the link target added.
 *
 * IT DOES NOT ASSUME THE FORMATTER HAS RUN, and must not. `prettier` 3.9.6 rewrites `*italic*` into
 * `_italic_`, so underscore is the form italic emphasis survives in once `pnpm format` has run, but
 * CI runs `typecheck`, `lint`, `test:coverage` and `build` and NOT `format:check`. Both spellings
 * can therefore reach `main`, which is why both are stripped rather than the formatter's output
 * alone. The underscore is the tree's house form on its own count, independent of that.
 *
 * ONE FACE OF THE SAME DEFECT IS NOT CLOSED HERE, and it says why at its own site: the hyphenated
 * compound ("the guest-count threshold") is a declared miss with a measured cost, at
 * `ATTENDEE_COUNT_SOURCE` above. Turning every hyphen into a space would rewrite "food-service" and
 * "2026-08-07" too, and the numeral half deliberately refuses a hyphenated number, so it has no
 * normalization that closes it for free.
 *
 * The other face was a count phrase wrapped inside a `*`-leader DOC COMMENT, and it was structural
 * rather than lexical: `blocksOf` read a ` * ` leader as a list bullet, so each line was its own
 * block and there was no wrapped line left for this function to rejoin. It is closed in `blocksOf`,
 * where it lived, and nothing here changed to close it: stripping `*` already put the two halves
 * on one line the moment they were in one block.
 *
 * MEASURED, not predicted: with this in place the scan flags both planted records above, and the
 * flag set on the clean tree is unchanged at ten, the four pinned records and the six benign pairs.
 */
/**
 * Every markdown link destination removed, the whole destination and not a prefix of it.
 *
 * IT COUNTS PARENTHESES RATHER THAN STOPPING AT THE FIRST `)`, which is the seventeenth PR #247
 * round. The `\]\([^)\n]*\)` this replaces ended the destination at its first closing parenthesis,
 * and a balanced pair inside a URL is an ordinary shape rather than a contrived one: the archival
 * and encyclopedic sources this repository's `docs/VERIFICATION-SOURCES.md` cites write them. So
 * "DOHMH depends on the [guest](https://example.test/source_(archived)) count" left the trailing
 * `)` in the prose and normalized to "DOHMH depends on the guest) count", which is neither the
 * "guest count" phrase `ATTENDEE_COUNT` joins with a single space nor anything else either count
 * expression matches. The unsupported trigger was then missed by the repository scan and by the
 * published-output audit alike, on a link a reader sees no defect in.
 *
 * A destination that never balances, or that runs past the end of its line, is LEFT ALONE, which is
 * what the old expression did with it too: a `](` with no closing parenthesis on its line is not a
 * link, and removing text up to some later line's parenthesis would delete prose the author wrote.
 */
const withoutLinkTargets = (text) => {
  let kept = "";
  let from = 0;
  for (;;) {
    const opened = text.indexOf("](", from);
    if (opened === -1) return kept + text.slice(from);
    let depth = 0;
    let at = opened + 1;
    for (; at < text.length && text[at] !== "\n"; at += 1) {
      if (text[at] === "(") depth += 1;
      else if (text[at] === ")" && (depth -= 1) === 0) break;
    }
    if (depth === 0 && text[at] === ")") {
      kept += `${text.slice(from, opened)}]`;
      from = at + 1;
    } else {
      kept += text.slice(from, opened + 2);
      from = opened + 2;
    }
  }
};

/**
 * Every REFERENCE-STYLE link label removed, the visible text kept. This is the twenty-first PR #247
 * round, and it is the same defect as the destination scan above one markdown spelling over.
 *
 * `[guest][ref]` renders as "guest". Stripping the brackets alone left `guestref`, so "DOHMH
 * depends on the [guest][ref] count" normalized to "DOHMH depends on the guestref count", which is
 * neither the "guest count" phrase `ATTENDEE_COUNT` joins with a single space nor anything else
 * either count expression matches. The claim was then missed by the repository scan and by the
 * published-output audit alike, on a link a reader sees no defect in, exactly as the inline form
 * was before the seventeenth round.
 *
 * The label ends at the first `]` and may not cross a line, on the same reading that leaves an
 * unbalanced inline destination alone: a `][` with no closing bracket on its line is not a link,
 * and removing text up to some later line's bracket would delete prose the author wrote. The
 * COLLAPSED form `[guest][]` needed nothing here and still does, because an empty label leaves the
 * two brackets adjacent, but it is covered by the same expression rather than by luck.
 */
const withoutReferenceLabels = (text) => text.replace(/\]\[[^\]\n]*\]/g, "]");

/**
 * Horizontal whitespace collapsed to the single space every count expression joins its words with.
 * The twenty-first PR #247 round, and the lexical half of the same defect `joinWrappedLines` closes
 * structurally.
 *
 * Every expression in this module writes its gaps as a literal `" "`, so "75  guests" with two
 * spaces, "75\tguests" with a tab and a "75 guests" whose space is U+00A0 pasted from a rendered
 * page each failed to match while rendering as the phrase an organizer reads. All three are
 * ordinary formatting: a double space survives markdown, a tab is what a paste from a table gives,
 * and a non-breaking space is what a paste from a rendered page gives.
 *
 * The class is every whitespace character EXCEPT the line break, so this cannot join two lines that
 * `joinWrappedLines` decided to keep apart, and it is one linear pass rather than a quantified
 * expression that can backtrack, which is the cost that function's own header measures.
 */
const collapseSpaces = (text) => text.replace(/[^\S\n]+/g, " ");

/**
 * ONE HTML TAG, opening, closing or self-closing, and nothing that merely looks like one.
 *
 * The name has to start the tag immediately, so `a < b` and `<= 75` are the comparisons they are,
 * and an autolink (`<https://example.test/75-guests>`) is left alone because a scheme's colon is
 * not part of a tag name. An attribute list may carry anything but the angle brackets themselves.
 */
const HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g;

/**
 * The named character references this decodes. Six, and not the WHATWG table's 2,231: these are
 * the five predefined XML entities every HTML author writes plus the non-breaking space, which is
 * the one a count phrase is actually broken by. An unrecognised name is LEFT AS WRITTEN, so a page
 * using a wider entity is read no worse than it is today rather than being silently half-decoded.
 */
const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

const decodeEntities = (text) =>
  text.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g,
    (whole, decimal, hex, name) => {
      if (name !== undefined) return NAMED_ENTITIES.get(name.toLowerCase()) ?? whole;
      const code = Number.parseInt(decimal ?? hex, decimal === undefined ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    },
  );

/**
 * THE RENDERED TEXT OF A PAGE, rather than the markup an organizer never sees. This is the
 * twenty-second PR #247 round, and it is what the twenty-first round's `.html` addition still
 * needed: adding the extension put the FILE inside the walk and left the SCAN reading raw markup,
 * so a claim written in ordinary markup was in the guard's reach and out of its vocabulary.
 *
 * Both spellings are ordinary rather than adversarial. `DOHMH requires a permit for 75&nbsp;guests`
 * is how a page keeps a number and its noun on one line, and `75 <strong>guests</strong>` is how it
 * emphasises the threshold; each renders as the count phrase an organizer reads, and neither was
 * the literal "75 guests" that `COUNTED_PEOPLE` joins with a single space. That is the same defect
 * the emphasis markers had in markdown in the eighth round, in the markup language the twenty-first
 * round brought into the walk.
 *
 * THE TAGS GO FIRST AND THE ENTITIES SECOND, which is the order a parser reads them in and is not
 * interchangeable: `&lt;strong&gt;` is text an author escaped ON PURPOSE, and decoding first would
 * turn it into a tag and delete the words it wraps.
 *
 * A TAG IS REMOVED RATHER THAN REPLACED BY A SPACE, because inline markup wraps a word rather than
 * separating two: `75<strong>guests</strong>` reads as the phrase and `guest<br>count` does not,
 * which is what a line break between them means. The cost is the mirror of that and is stated: a
 * word an author split across a tag boundary is rejoined, exactly as the emphasis markers already
 * rejoin one.
 *
 * IT IS NOT SCOPED TO `.html`, for the reason the emphasis markers are not scoped to `.md`.
 * Markdown carries inline HTML by specification and this tree's `.tsx` files carry it as JSX, so a
 * claim wrapped in a tag is the same claim wherever the tag is written. Its cost in code is stated
 * too: a TypeScript generic (`Array<string>`) matches the tag shape and is removed before matching,
 * which joins its neighbours and states no count. Measured over every scanned root, the flag set is
 * unchanged at the four pinned records and the six benign pairs with this in place.
 */
const asRenderedText = (text) => decodeEntities(text.replace(HTML_TAG, ""));

/**
 * EVERY REMAINING LOCATOR REMOVED: a bare or autolinked `http(s)` URL, with the angle brackets an
 * autolink wraps it in. This is the twenty-third PR #247 round, and it is a FALSE POSITIVE fixed
 * rather than a miss closed.
 *
 * `withoutLinkTargets` removes an inline destination, so `DOHMH [source](https://example.test/
 * 75-guests)` was already clean while `DOHMH source: <https://example.test/75-guests>` and the same
 * URL written bare were reported as fabricated regulatory claims. The path slug is what pairs: the
 * hyphenated count alternation reads `75-guests` as a threshold. Two spellings of one link
 * disagreeing is bad enough; what makes it worth fixing here is the consequence, which is that
 * updating a source URL fails the repository-wide guard on a document that states no threshold.
 * That is the same shape as the `sources[].urls` finding the twenty-second round fixed, one artifact
 * kind over: `isUrlField` answers it for a JSON contract field and reaches no prose, so prose needs
 * its own answer and this is it.
 *
 * A PATH IS NOT A SENTENCE, which is the reading both answers share. `outputStrings` has excluded a
 * URL from the published-output audit since the tenth round for exactly this reason, and the note
 * there names this very shape: "a path fragment like `.../guests-75` would read as a count".
 *
 * IT RUNS AFTER THE TAGS ARE REMOVED and not before, because an `href` inside a tag is part of the
 * tag: removing the URL first would leave `<a href="` behind, which is no longer the tag shape, and
 * the attribute text would survive into the prose.
 *
 * The cost is stated: a scheme-less locator (`www.example.test/75-guests`) is not matched and still
 * reads as prose, and a count phrase an author writes INSIDE a URL is no longer read. Neither is a
 * sentence an organizer acts on. Measured over every scanned root, the flag set is unchanged at the
 * four pinned records and the six benign pairs.
 */
const withoutLocators = (text) => text.replace(/<?\bhttps?:\/\/[^\s>]+>?/gi, "");

export const normalizeForMatching = (text) =>
  collapseSpaces(
    joinWrappedLines(
      withoutLocators(asRenderedText(withoutReferenceLabels(withoutLinkTargets(text))))
        .replace(/[`*_~[\]"“”]/g, "")
        .replace(/(?<![A-Za-z0-9])'|'(?![A-Za-z0-9])/g, ""),
    ),
  );

/** A line that opens a list item or a table row, and so begins a block of its own. */
const LIST_OR_ROW = /^[\s/*#-]*([-*+]\s|\d+\.\s|\|)/;

/**
 * Paragraphs, list items and table rows. A block ends where the next one begins.
 *
 * INSIDE A `/* ... *\/` COMMENT THE LEADING `*` IS THE COMMENT'S OWN LEADER rather than a markdown
 * bullet, and the list test reads the line with that leader removed. This is the NINTH round's
 * declared miss closed rather than restated: a normally wrapped doc comment put every continuation
 * line in a block of its own, so a claim with the agency on one line and "75 or more guests" on the
 * next was two half-claims and neither half was a count. `spec-conflict-resolutions.fixtures.test
 * .mjs` carried that as an EXPECTED MISS, on the reading that "a markdown `* ` bullet is
 * indistinguishable from a doc-comment line". It is distinguishable: the `/**` that opened the
 * comment is on an earlier line, which is what this loop tracks. That reading was an accommodation
 * of this function's behaviour rather than a decision, and the shape it left open is the one this
 * whole guard exists about, in the file kind where the struck clause actually sat.
 *
 * A `* ` line in a MARKDOWN file is still a bullet and still its own block, because no comment is
 * open there. So is a `* ` line inside a doc comment, which is an ordinary markdown bullet an author
 * wrote in a comment: the leader is stripped, the bullet under it is not, and the ordinary-English
 * tier of the cross-boundary pass keeps the boundary it is built on.
 *
 * The block text stays RAW, leader included, because that is what a pin digests. Rejoining the
 * wrapped line is `normalizeForMatching`'s job and it already does it: `*` is one of the inline
 * markers it strips, so the leader is gone before the line break is collapsed.
 *
 * A blank comment line (` *` alone) becomes an EMPTY block, which is what it is: a paragraph break
 * inside the comment. Pushing the raw line instead would leave a block between two paragraphs a
 * reader sees as adjacent, and the cross-boundary pass would stop reading them together.
 */
export const blocksOf = (text) => {
  const blocks = [""];
  let inComment = false;
  for (const line of text.split("\n")) {
    const content = inComment ? line.replace(/^[ \t]*\*(?!\/)/, "") : line;
    const blank = content.trim().length === 0;
    if (blank || LIST_OR_ROW.test(content)) blocks.push(blank ? "" : line);
    else blocks[blocks.length - 1] += `\n${line}`;
    // Read off the raw line and after it is classified, so the `/**` that opens a comment is still
    // the bullet-shaped line it has always been and only what FOLLOWS it is a continuation.
    const opened = line.lastIndexOf("/*");
    const closed = line.lastIndexOf("*/");
    if (opened > closed) inComment = true;
    else if (closed > opened) inComment = false;
  }
  return blocks;
};

/** The line a block's kind is read off: its first, with the block's own indentation removed. */
const openingLine = (block) => block.trim().split("\n")[0] ?? "";

/** Whether a block is a prose paragraph rather than a list item or a table row. */
export const isParagraph = (block) => !LIST_OR_ROW.test(openingLine(block));

/** A line that opens a markdown heading, comment leader included, and a line that opens a list
 * item. A table row is neither: `LIST_OR_ROW` covers both list items and rows, and the scoping
 * below is about a list under a heading rather than about a table. */
const HEADING = /^[\s/*]*#{1,6}\s/;
const LIST_ITEM = /^[\s/*]*(?:[-*+]\s|\d+\.\s)/;

/**
 * A SETEXT HEADING'S UNDERLINE: the row of `=` or `-` that makes the line above it a heading. The
 * comment leader is allowed before it for the reason `HEADING` allows one, and nothing but
 * whitespace may follow it.
 */
const SETEXT_UNDERLINE = /^[\s/*]*(?:=+|-+)[ \t]*$/;

/**
 * Whether a block is a markdown heading. Headings are paragraphs by `isParagraph`, which is what
 * `LIST_OR_ROW` says they are; this is the narrower question the heading scoping asks.
 *
 * BOTH OF MARKDOWN'S HEADING FORMS, which is the twenty-second PR #247 round. Only the ATX form
 * (`## DOHMH requirements`) was recognised, so the twentieth round's list scoping never fired under
 * the other one: `DOHMH requirements\n-------------------` over `- Required for 75 guests` renders
 * as exactly the heading-and-list relationship that round exists to read, and the ordinary-English
 * tier refused it because the heading was, to this predicate, a paragraph. The underline sits in
 * the SAME BLOCK as the text it underlines, because `blocksOf` starts a new block only at a list
 * item or a table row and a row of dashes is neither, so the question is about the block's second
 * line rather than about its neighbour.
 *
 * A LIST ITEM UNDER A ROW OF DASHES IS STILL A LIST ITEM: markdown reads a Setext underline against
 * a PARAGRAPH, so a block whose opening line is a bullet or a table row is excluded here the way it
 * is excluded from `isParagraph`.
 */
export const isHeading = (block) => {
  const lines = block.trim().split("\n");
  if (HEADING.test(lines[0] ?? "")) return true;
  return (
    lines.length > 1 && !LIST_OR_ROW.test(lines[0] ?? "") && SETEXT_UNDERLINE.test(lines[1] ?? "")
  );
};

/** Whether a block is a list item, ordered or not. */
export const isListItem = (block) => LIST_ITEM.test(openingLine(block));

/**
 * THE SUBJECTS A CLAIM MAY NAME: the city health agency, and every INSTRUMENT IDENTITY the
 * published ruleset gives that agency's own rules. This is the eighteenth PR #247 round.
 *
 * The agency name was the only subject this scan recognised, so a claim that names the instrument
 * and omits the label was dropped whole. "A Temporary Food Service Establishment permit is required
 * for 75 guests" carries no recognised agency alias, so `scanFile` and
 * `countClaimsInPublishedOutput` returned no offender for it, in a tracked document and in another
 * agency's published note alike. An organizer reads the permit's name as the claim's subject; so
 * does this scan now.
 *
 * WHICH STRINGS ARE AN IDENTITY IS THE ARTIFACT'S ANSWER AND NOT A LIST HERE. They are the three
 * fields the code already treats as the name of a requirement: `output.permit_name` and
 * `output.requirement_name`, which `packages/engine/src/ruleset.ts:513-515` reads in that order as
 * a rule's `name`, and `output.user_summary.heading`, which `packages/engine/src/findings.ts:305`
 * makes the title of the rendered plan line. A rule published tomorrow brings its own identity into
 * this set the day it lands.
 *
 * `advisory_text` and `note_text` are the other two fallbacks `ruleset.ts` reads and they are NOT
 * here WHOLE: they are sentences rather than titles, and a whole sentence as a subject makes the
 * audit's subject the entire claim, which matches only a verbatim quotation and reports nothing new.
 * The TITLE INSIDE such a sentence is a different thing and `titledInstruments` below takes it.
 *
 * A TITLED INSTRUMENT NAMED IN ORGANIZER-FACING SUMMARY TEXT IS AN IDENTITY TOO, which is the
 * nineteenth PR #247 round. The three fields above were the whole set, so an instrument the ruleset
 * publishes only inside a sentence was no subject: `rules/nyc-rules.v2.11.json:1721` names the
 * "Temporary Food Service Establishment permit" in a `user_summary` point, and that name appears in
 * no identity FIELD anywhere in the artifact, so "A Temporary Food Service Establishment permit is
 * required for 75 guests" carried no recognised subject and produced no offender in tracked prose
 * or in another agency's published output.
 *
 * WHOSE IDENTITIES: `cityHealthRule`'s answer, the same classification the rest of this module and
 * `apps/api/src/rsvps.test.ts` use, so a rule published under `NYC Health` with no `DOHMH-` prefix
 * contributes its permit name here too.
 *
 * THE COST IS REAL AND IS STATED. These strings are matched as literal text, so a document that
 * quotes a published permit name beside an unrelated numeral is flagged with no claim in it, the
 * same way an adjacent pair of true statements is. That is the ordinary false-positive cost of
 * reading co-occurrence rather than stance, and the remedy is the one this guard already has: an
 * entry in `BENIGN_ADJACENT_PAIRS`, or wording that does not put the two together. Measured on this
 * tree the flag set does not move: the seven identities the published ruleset carries today are
 * `Acceptable DOHMH permit`, `Acceptable DOHMH permit per participating food vendor (TFSE / FSE /
 * MFV)`, `NYC Health Department food-vendor permits`, `Organizer notification to DOHMH`, `Organizer
 * notice to the NYC Health Department`, `Possible private-event food exemption` and `Temporary Food
 * Service Establishment permit`, and only the last two carry no agency alias of their own.
 *
 * They are NORMALIZED the way the text they are matched against is, so a name carrying a character
 * `normalizeForMatching` strips is still the name after both sides have been read as one line of
 * prose, and escaped so that a published `(`, `/` or `.` is the character it is rather than regular
 * expression syntax. An empty or whitespace-only identity is dropped: as an alternative it would
 * match every string in the tree.
 *
 * AN IDENTITY IS RETURNED WITH THE RULES THAT PUBLISH IT, which is the twenty-second PR #247 round
 * and is what `countsAttributed` needs to hold a claim to the instrument's OWNER. The set of
 * identities alone made a named instrument a claim SUBJECT without making it an ATTRIBUTION, so a
 * claim naming another rule's instrument fell through to the host: with `HEALTH-A` legitimately
 * published at 75 and the `Temporary Food Service Establishment permit` belonging to
 * count-independent `HEALTH-B`, "Temporary Food Service Establishment permit applies at 75 guests"
 * written into `HEALTH-A` was licensed by `HEALTH-A`'s own threshold and produced no offender. The
 * instrument's name is what an organizer reads the claim as being about, exactly as a rule id is.
 *
 * `publishedClaimSubjects` is the keys of this map, so the two answers cannot drift apart. An
 * identity two rules publish carries both, and both then have to license the claim, which is the
 * quantifier `countsAttributed` already applies to a sentence naming two rule ids.
 */
export const publishedInstrumentOwners = (artifact) => {
  const owners = new Map();
  for (const rule of [...(artifact?.rules ?? []), ...(artifact?.advisories ?? [])]) {
    if (!cityHealthRule(rule)) continue;
    const output = rule.output ?? {};
    const named = [output.permit_name, output.requirement_name, output.user_summary?.heading];
    for (const string of organizerFacingStrings(rule)) named.push(...titledInstruments(string));
    for (const identity of named) {
      if (typeof identity !== "string") continue;
      const normalized = normalizeForMatching(identity).trim();
      if (normalized === "") continue;
      const already = owners.get(normalized) ?? [];
      if (rule.id && !already.includes(rule.id)) already.push(rule.id);
      owners.set(normalized, already);
    }
  }
  return owners;
};

export const publishedClaimSubjects = (artifact) =>
  [...publishedInstrumentOwners(artifact).keys()].sort();

/** The nouns this jurisdiction's regulatory instruments are called by. */
const INSTRUMENT_NOUN =
  "(?:[Pp]ermit|[Ll]icen[cs]e|[Rr]egistration|[Cc]ertificate|[Nn]otification|[Nn]otice)s?";

/**
 * The instrument TITLES one organizer-facing string names: a run of capitalized words ending in one
 * of the nouns above, with a leading English determiner removed and at least two capitalized words
 * left after it.
 *
 * THE TITLE AND NOT THE SENTENCE, which is what makes this a subject rather than a quotation. An
 * identity field is a title already; a summary point is a sentence with a title inside it, and
 * "A Temporary Food Service Establishment permit is published at $70 per year." publishes the
 * instrument's name exactly as a `permit_name` would.
 *
 * TWO CAPITALIZED WORDS IS THE LINE BETWEEN A TITLE AND A DESCRIPTION, and it is where it is
 * because it was measured rather than chosen. Over the three ruleset artifacts this tree carries,
 * the runs of one capitalized word are `TFSE permit`, `Organizer notice` and `Organizer
 * notification`: a bare acronym and two generic descriptions, and a generic description as a
 * subject makes any sentence about any organizer's notice a city health claim. The runs of two or
 * more are `Temporary Food Service Establishment permit`, `Acceptable DOHMH permit`, `Health
 * Department permit` and `NYC Health permit`, every one of which is an instrument this agency
 * publishes, and three of the four already carry an agency alias of their own.
 *
 * THE DETERMINER IS REMOVED because a sentence-initial `A`, `An` or `The` is capitalized by
 * grammar rather than by title, and keeping it would leave the subject matching only the wording
 * that happens to begin a sentence. It is the three English determiners and nothing else: any
 * longer list would be this function guessing at grammar, which is the failure the next paragraph
 * bounds.
 *
 * WHAT THIS IS NOT is a general reading of prose. It recognizes a name that is CAPITALIZED and ends
 * in a declared noun, so an instrument written in lower case, or called something this noun list
 * does not carry, is still no subject. The general version of the question is to key on the
 * instrument noun itself rather than on the agency, and it is not built here for a measured reason:
 * over every scanned root, blocks pairing any of these nouns with a count run 59 against the ten
 * this guard flags today, and nearly all of the extra 49 are true published facts about OTHER
 * agencies ("park headcount 19/20/21"). A bare instrument noun does not say whose instrument it is,
 * and whose it is has been the whole question since the first round.
 */
export const titledInstruments = (text) => {
  const titles = new RegExp(`(?:[A-Z][A-Za-z-]*\\s+)+${INSTRUMENT_NOUN}\\b`, "g");
  return (typeof text === "string" ? (text.match(titles) ?? []) : [])
    .map((title) => title.replace(/^(?:A|An|The)\s+/, ""))
    .filter((title) => title.split(/\s+/).length > 2);
};

const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The four expressions every pairing question is asked through, for one set of extra subjects: the
 * subject itself, and its three proximity windows.
 *
 * Built once per subject set rather than per block. `scanFile` asks these questions of every block
 * of every file in the tree, and a `RegExp` compiled from a published permit name on each of them
 * would be the walk's cost rather than a rounding error.
 */
const subjectCache = new Map();
export const claimSubject = (subjects = []) => {
  const usable = subjects.filter((subject) => typeof subject === "string" && subject.trim() !== "");
  const key = JSON.stringify(usable);
  const cached = subjectCache.get(key);
  if (cached !== undefined) return cached;
  const source = [CITY_HEALTH_AGENCY_SOURCE, ...usable.map(escapeForRegExp)].join("|");
  const near = (count) =>
    new RegExp(
      `(?:${source})[\\s\\S]{0,${PROXIMITY}}?(?:${count})` +
        `|(?:${count})[\\s\\S]{0,${PROXIMITY}}?(?:${source})`,
      "i",
    );
  const built = {
    source,
    pattern: new RegExp(source, "i"),
    nearCountedPeople: near(COUNTED_PEOPLE_SOURCE),
    nearAttendeeCount: near(ATTENDEE_COUNT_SOURCE),
    nearAnyCount: near(`${ATTENDEE_COUNT_SOURCE}|${COUNTED_PEOPLE_SOURCE}`),
  };
  subjectCache.set(key, built);
  return built;
};

/**
 * Whether one block supplies the agency and the other supplies a `count` match, in either
 * direction. THIS IS WHAT MAKES A PAIR A CROSS-BOUNDARY FINDING, and it is a stricter question
 * than "does the concatenation pair", which was the sixth PR #247 review round's item 3.
 *
 * The concatenation pairs whenever EITHER block pairs on its own, so a pass built on it has to
 * suppress the pairs around any block that already pairs alone or the same claim is reported three
 * times. That suppression is what blanked the boundaries on both sides of every pinned record and
 * of the opt-out block: a block whose own pairing is exempt still swallowed its two boundaries, so
 * a count half planted in the paragraph after a pinned decision record was never read against the
 * agency the pin names. Asking instead for one half on each side needs no suppression: a pair
 * beside a self-pairing block is silent unless the neighbour really contributes the other half.
 */
const splitAcrossBoundary = (first, second, count, subject = CITY_HEALTH_AGENCY) =>
  (subject.test(first) && count.test(second)) || (count.test(first) && subject.test(second));

/**
 * Whether one block pairs the city health agency with an attendee count, the block read as one
 * line of prose (`normalizeForMatching`).
 *
 * `bounded` is what `BOUNDED_EXTENSIONS` decides. The `ATTENDEE_COUNT` half is unbounded either
 * way: those phrases name a count outright, so a block carrying one and the agency is putting the
 * two in the same authored unit wherever they sit in it.
 */
export const pairsAgencyWithCount = (raw, { bounded = false, subjects = [] } = {}) => {
  const text = normalizeForMatching(raw);
  const subject = claimSubject(subjects);
  return (
    subject.pattern.test(text) &&
    (ATTENDEE_COUNT.test(text) || (bounded ? subject.nearCountedPeople : COUNTED_PEOPLE).test(text))
  );
};

/**
 * The ATTRIBUTION UNITS of a text already read as one line of prose. A unit ends at one of the
 * three ordinary sentence terminators or at a semicolon, followed by whitespace, which is the same
 * boundary `COUNTED_PEOPLE`'s noun-first alternation refuses to cross, so no phrase either count
 * expression matches can straddle one of these splits.
 *
 * THE SEMICOLON IS A UNIT BOUNDARY TOO, which is the nineteenth PR #247 round. The three sentence
 * terminators were the whole list, so two INDEPENDENT CLAUSES joined by a semicolon stayed one
 * attribution unit and the supported clause licensed the unsupported one. On a rule legitimately
 * publishing 75, "HEALTH-A, published by DOHMH, applies at 75 guests; the vendor permit depends on
 * the guest count." came out of this split as ONE claim that names HEALTH-A and states 75, so
 * `countsAttributed` exempted it and the second clause, which names no rule at all, was reported by
 * nobody in repository prose and in published output alike.
 *
 * A SEMICOLON JOINS TWO CLAUSES THAT COULD EACH STAND AS A SENTENCE, which is what makes this the
 * same boundary rather than a fourth special case: what this function answers is "which span of
 * text is one claim held to one rule", and an independent clause is one claim by the same reading
 * that makes a sentence one. The cost is the mirror of the exemption it removes and is stated: a
 * legitimate count claim written across a semicolon now has to name its rule in the clause that
 * states the number, which is the same wording the period already required of it.
 *
 * MEASURED OVER EVERY SCANNED ROOT the flag set does not move: it stays at the four pinned
 * historical records and the six benign adjacent pairs, and the published artifact reports zero
 * offenders before and after.
 *
 * THE QUESTION AND EXCLAMATION MARKS ARE TERMINATORS TOO, which is the fourteenth PR #247 round.
 * Only the period was one, so an attributed sentence ending in `!` or `?` was joined to the next
 * one and the pair was read as a single claim: on a rule publishing 75, "HEALTH-ASSEMBLY-001
 * applies at 75 guests! DOHMH-VENDOR-PERMIT-001 depends on the guest count." came out of this
 * split as ONE claim carrying the legitimate rule id and the supported numeral, so
 * `countsAttributed` exempted it and the second half's unsupported claim was reported by nobody.
 * The terminator required whitespace after it before and still does, so "75.5" and "$1.2M" are
 * not two sentences.
 *
 * AN EM DASH IS A BOUNDARY TOO, which is the twenty-first PR #247 round and is the semicolon case
 * in the one punctuation mark this repository's own house style writes most. On a rule legitimately
 * publishing 75, "HEALTH-A, published by DOHMH, applies at 75 guests — the vendor permit depends on
 * the guest count." came out of this split as ONE unit naming HEALTH-A and stating 75, so
 * `countsAttributed` exempted it whole and the second clause, which names no rule at all, was
 * reported by nobody. That is the semicolon defect the nineteenth round closed, reachable again
 * through a different mark.
 *
 * The mark is the boundary WITH OR WITHOUT the spaces around it, unlike the terminators above,
 * because an em dash is not a decimal point or a thousands separator: nothing writes a number
 * around one, so there is no "75.5" case here to protect. The EN dash is deliberately not a
 * boundary: this tree writes it unspaced inside ranges ("Phase 2–4"), which is one token rather
 * than two clauses.
 */
const sentencesOf = (text) => text.split(/(?<=[.!?;])\s+|\s*—\s*/);

/** Whether a text states an attendee count at all, in either count vocabulary. */
const statesACount = (text) => ATTENDEE_COUNT.test(text) || COUNTED_PEOPLE.test(text);

/**
 * Every threshold a text states: EVERY count numeral of every SENTENCE that states a count, read
 * with the same guarded numeral both count expressions are built out of.
 *
 * THE UNIT IS THE SENTENCE AND THE QUANTIFIER IS `every`, which is the seventeenth PR #247 round.
 * This used to collect the numerals of each MATCHED PHRASE, and both count expressions reach to
 * their numeral LAZILY, so a phrase stopped at the first numeral it found and the rest of the
 * sentence was read by nobody. On a rule legitimately published at 75, "HEALTH-A applies when the
 * guest count is 75 rather than 500" produced the single-element set `{75}`, `countsSupportedBy`'s
 * `every` was satisfied by it, and the invented 500 was suppressed in repository prose and in
 * published output alike. One valid value concealing an invented one is the shape of the hole, and
 * widening the reach from lazy to greedy would only have swapped which of the two was concealed:
 * the set has to be every numeral or a claim can always hide behind the one that checks out.
 *
 * That makes the sentence the unit here, which is the unit `countsAttributed` already holds a claim
 * to, so a claim and the numbers it is audited on are now the same span of text. It replaces the
 * two phrase-level reaches (`COUNTED_PEOPLE`'s own, and the either-direction reach the sixteenth
 * round gave the `ATTENDEE_COUNT` vocabulary) with one rule that needs neither.
 *
 * THE COST IS THE MIRROR OF THE REACH IT REPLACES, widened from the phrase to the sentence and
 * stated rather than left to be discovered: an unrelated numeral sharing a sentence with a count
 * phrase is read as a stated threshold. "Apply 21 days ahead when the guest count is high" claimed
 * 21 under the old reach and still does; "the $75 fee applies once the guest count reaches 500" now
 * claims 75 as well. What that costs is an offender reported against a rule that publishes no 75,
 * which is a failure a reader can check and correct in one edit, not a claim missed. The numerals
 * of a sentence that states NO count are still read by nobody, so a fee or a date in a neighbouring
 * sentence excuses nothing.
 *
 * THE NUMERAL IS THE GUARDED TOKEN `COUNT_NUMERAL` IS, widened by the one shape the hyphenated
 * alternation of `COUNTED_PEOPLE` admits: a numeral whose hyphen is followed by a counted-person
 * noun ("75-person"). Reading the numerals of a whole sentence rather than of a matched phrase is
 * what makes the TRAILING guard affordable, and it is worth having: `-001` and `2026-08-07` are a
 * rule id and a date in any sentence, and the phrase-level reader had to drop that guard because
 * "75-person" would have lost it. `NUMERAL_BODY` is the body, so a formatted count is still parsed
 * as the whole number an organizer reads and "1,075 guests" is 1075 rather than 75.
 *
 * TWO GUARDS ARE HERE THAT `COUNT_NUMERAL` DOES NOT CARRY, and the sentence is what forces both.
 * A phrase-level reader only ever saw the digits its own phrase matched; a sentence carries the
 * tokens around them too.
 *
 *   - NOT THE PREFIX OF A GROUPED NUMBER (`(?!,\d{3})`). `NUMERAL_BODY` prefers its grouped
 *     alternative, but where the token after the group defeats a lookahead the plain alternative
 *     backtracks into it: "1,075-person" would otherwise be read as 1, on the "1" that ends in the
 *     separator. It is the mirror of the `(?<!\d,)` guard the fifteenth round added for the suffix.
 *   - NOT THE FRACTIONAL HALF OF A DECIMAL (`(?<!\d\.)`). A decimal point is not a sentence
 *     terminator here, precisely so a claim written around one stays one claim, so "applies above
 *     74.5 at 75 guests" is one sentence and its digits are in reach. 74 and 5 are not two stated
 *     thresholds there.
 *
 * A DECIMAL IS READ WHOLE RATHER THAN DROPPED, which is the twenty-first PR #247 round and is the
 * one guard of these two that changed. Both halves used to be refused, so a claim whose number was
 * WRITTEN as a decimal stated no number at all: on a rule legitimately publishing 75, "HEALTH-A,
 * published by DOHMH, applies at 500.0 guests" pairs (the count expressions read "0 guests" off the
 * fraction), names an attributed rule, and produced the EMPTY claimed set, so `countsSupportedBy`'s
 * `every` was satisfied vacuously and an invented threshold borrowed the rule's attribution. A
 * vacuous pass on a count-bearing claim is the one outcome this reader may not produce.
 *
 * So the fraction is part of the numeral and "500.0" claims 500, which is the number an organizer
 * reads. "74.5" claims 74.5, which no trigger publishes and which is therefore an offender rather
 * than a silence: a claim that states a half-person threshold about a rule is stating a number the
 * rule does not publish.
 *
 * THE DECIMAL IS ALL OR NOTHING, which is the one thing the two alternatives buy over an optional
 * group. An optional fraction BACKTRACKS: on "$1.2M" the whole decimal fails the trailing guard at
 * the `M`, the group gives up its ".2", and the bare "1" passes, so a fee would claim a threshold
 * of 1. The bare alternative therefore refuses a numeral a fraction follows, which is the guard the
 * old expression carried as `(?!\.\d)`, kept for the case it was really for.
 */
const CLAIMED_NUMERAL = new RegExp(
  `(?<![\\w-])(?<!\\d,)(?<!\\d\\.)` +
    `(?:${NUMERAL_BODY}\\.\\d+|${NUMERAL_BODY}(?!\\.\\d))(?!,\\d{3})` +
    `(?:(?![\\w-])|(?=-${COUNTED_PERSON_NOUN}\\b))`,
  "gi",
);
export const claimedCounts = (raw) => {
  const found = new Set();
  for (const sentence of sentencesOf(normalizeForMatching(raw))) {
    if (!statesACount(sentence)) continue;
    for (const numeral of sentence.match(CLAIMED_NUMERAL) ?? []) {
      found.add(Number(numeral.replaceAll(",", "")));
    }
  }
  return found;
};

/**
 * THE SEVEN OPERATORS a published trigger may compare a field with, and what each one publishes
 * about a NUMBER. The union is `ConditionOperator` in `packages/engine/src/types.ts`, and
 * `spec-conflict-resolutions.test.mjs` reads that line and fails if this table and that union stop
 * naming the same seven, so this is the engine's enumeration rather than a remembered copy of it.
 *
 *   - `inclusive`: the rule applies AT the value, so prose may state it however it is worded.
 *     `eq` and `in` name the values outright and `gte` includes its boundary.
 *   - `exclusive`: the rule applies only STRICTLY BEYOND the value, so the value is a boundary the
 *     rule publishes and NOT a count at which it applies. That is `gt`.
 *   - `none`: the operator compares no number at all, so the rule licenses none. `bool`,
 *     `contains` and `contains_any` are answered against a flag or a multi-select.
 *
 * An operator this table does not name licenses NOTHING, which is the fail-closed direction: a
 * future `lt` or `lte` (the proposed draft already writes one) reports its rule's prose until
 * somebody says here what it publishes, rather than licensing a number on a comparison this guard
 * has never read.
 */
export const THRESHOLD_OPERATORS = {
  eq: "inclusive",
  in: "inclusive",
  gte: "inclusive",
  gt: "exclusive",
  bool: "none",
  contains: "none",
  contains_any: "none",
};

/**
 * Every threshold one trigger publishes for one field, as `{ value, exclusive }`, at any nesting
 * depth of `all` / `any`. This is the twenty-third PR #247 round.
 *
 * THE OPERATOR USED TO BE DISCARDED. The extraction collected every numeric `value` a condition on
 * the field carried and handed the caller a set of bare numbers, so `headcount > 75` published the
 * same `{75}` as `headcount >= 75`, and `countsSupportedBy` then licensed organizer-facing prose
 * saying the rule applies AT 75 when the published trigger fires only above it. A guard whose whole
 * subject is "prose may state only what the ruleset publishes" cannot treat two different published
 * facts as the same number.
 *
 * `boundary: "conditional"` MAKES AN EXCLUSIVE COMPARISON INCLUSIVE, and the artifact is what says
 * so rather than a preference here. `DOB-TENT-001` publishes `tent_area_sqft gt 400` with that
 * boundary and its own note reads "Exactly 400 sq ft sits ON the published 'more than 400' boundary
 * → engine renders CONDITIONAL": the rule publishes an outcome AT 400, so prose naming 400 is
 * naming a fact the rule states. `packages/engine/src/conditions.ts:263-279` is where the engine
 * reads the same field the same way.
 */
export const publishedThresholds = (node, field, into = []) => {
  if (Array.isArray(node)) for (const child of node) publishedThresholds(child, field, into);
  else if (node && typeof node === "object") {
    if (node.field === field) {
      const kind = THRESHOLD_OPERATORS[node.op] ?? "none";
      if (kind !== "none") {
        for (const value of [node.value].flat()) {
          if (typeof value === "number") {
            into.push({
              value,
              exclusive: kind === "exclusive" && node.boundary !== "conditional",
            });
          }
        }
      }
    }
    for (const value of Object.values(node)) publishedThresholds(value, field, into);
  }
  return into;
};

/** A count as a claim may spell it: bare, and with the thousands separators an author writes. */
const numeralSpellings = (value) => {
  const plain = String(value);
  const grouped = plain.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return [...new Set([plain, grouped])].map(escapeForRegExp).join("|");
};

/**
 * The relations that state a threshold as one the rule sits STRICTLY BEYOND. Two modifier words are
 * allowed between the relation and the numeral, which is the window both count expressions already
 * take for "75 or more confirmed guests".
 */
const STRICTLY_BEYOND =
  "(?:more than|greater than|larger than|higher than|above|over|beyond|in excess of|exceeds?|exceeding)";
const statedBeyond = (text, value) =>
  new RegExp(
    `${STRICTLY_BEYOND}(?: [a-z][a-z-]*){0,2} (?:${numeralSpellings(value)})\\b`,
    "i",
  ).test(text);

/**
 * Whether every threshold a text states is one the rule it belongs to really publishes, AS the rule
 * publishes it.
 *
 * `published` is that rule's own thresholds for the attendee-count field: `publishedThresholds`'
 * `{ value, exclusive }` entries, or a bare number, which is the INCLUSIVE spelling and is what a
 * set of numbers has always meant here. A text stating no number is supported by a rule that reads
 * the field; a text stating a number the rule does not publish is not, whatever field its trigger
 * reads.
 *
 * AN EXCLUSIVE BOUNDARY HAS TO BE STATED AS ONE, which is the twenty-third PR #247 round. On
 * `headcount gt 75` the rule applies above 75 and not at it, so "applies at 75 guests" and "applies
 * to 75 guests or fewer" are both claims the published trigger contradicts, and both used to be
 * licensed by the bare numeral. The claim now has to carry a relation that puts the rule beyond the
 * boundary ("more than 75 guests", "over 75 guests"), and states the number the trigger really
 * carries while doing it.
 *
 * READING A RELATION HERE IS NOT THE DENYLIST THIS GUARD REMOVED, and the difference is the
 * direction it fails in. The verb list this branch took out decided whether a sentence WAS a claim,
 * so a wording nobody thought of was a claim missed. This list decides whether a claim is EXEMPT, so
 * a wording nobody thought of is a claim REPORTED: an author who writes "applies past 75 guests"
 * gets an offender naming the sentence, not silence. `countClaimsInPublishedOutput` states the same
 * declared limit about direction that this narrows: the direction of an INCLUSIVE threshold is still
 * uncompared, because there the rule really does apply at the number the prose names.
 */
export const countsSupportedBy = (raw, published) => {
  const licensed = new Map();
  for (const threshold of published) {
    const { value, exclusive } = typeof threshold === "number" ? { value: threshold } : threshold;
    // A value published both ways is published inclusively: one route applies at it.
    licensed.set(value, (licensed.get(value) ?? true) && Boolean(exclusive));
  }
  const text = normalizeForMatching(raw);
  return [...claimedCounts(raw)].every(
    (value) => licensed.has(value) && (!licensed.get(value) || statedBeyond(text, value)),
  );
};

/**
 * Whether a text NAMES a rule, as a complete token rather than as a substring.
 *
 * `String.includes` was the test until the fourteenth PR #247 round, and a rule id is a prefix or a
 * suffix of the ids around it as a matter of house style: with `HEALTH-ASSEMBLY-001` legitimately
 * publishing 75, both "OLD-HEALTH-ASSEMBLY-001 is a DOHMH permit at 75 guests." and
 * "HEALTH-ASSEMBLY-001-NOTE says DOHMH applies at 75 guests." contained the attributed id and so
 * borrowed its exemption for a rule that publishes nothing. A superseded, qualified or companion
 * rule reusing the base id is the ordinary way that becomes reachable.
 *
 * The boundary is `ID_CHARACTER` on both sides rather than `\b`, because `\b` sits between `Y` and
 * `-` and would accept both of those. It is a scan over the occurrences rather than a regex,
 * because the id is DATA from the artifact: building a pattern out of it means escaping it, and an
 * escape that misses a character turns a published rule id into a pattern that matches something
 * else. A run off the end of the string reads as a boundary, so an id at either end is named.
 */
const ID_CHARACTER = /[\w-]/;
const namesRule = (text, id) => {
  const haystack = text.toLowerCase();
  const needle = id.toLowerCase();
  if (needle === "") return false;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack[at - 1] ?? " ";
    const after = haystack[at + needle.length] ?? " ";
    if (!ID_CHARACTER.test(before) && !ID_CHARACTER.test(after)) return true;
  }
  return false;
};

/**
 * Whether every count a text states is attributable to a rule whose published trigger really reads
 * the attendee count: the count sits in a SENTENCE that names that rule, and states no number the
 * rule does not publish. `attributed` is the same rule-id-to-thresholds mapping `claimedCounts`'
 * caller builds from the published triggers.
 *
 * THE UNIT IS THE SENTENCE AND NOT THE BLOCK, which is the twelfth PR #247 round. The caller used
 * to ask whether the block NAMES an attributed rule and whether the BLOCK's counts are supported,
 * which is attribution by co-occurrence: the day a city health rule legitimately reads the count,
 * one sentence naming that rule exempts every other claim sharing its block. On a rule publishing
 * 75, "HEALTH-ASSEMBLY-001 applies at 75 guests. DOHMH-VENDOR-PERMIT-001 depends on the guest
 * count." was skipped whole, and the second sentence is an unsupported claim about a rule whose
 * trigger reads no count at all.
 *
 * A COUNT-STATING SENTENCE THAT NAMES NO RULE IS NOT ATTRIBUTED, which is stricter than removing
 * the sentences that are and re-reading the rest. "HEALTH-ASSEMBLY-001, published by DOHMH, applies
 * at 75 guests. The vendor permit starts at 500 guests." has a second sentence that names no agency
 * of its own, so a residue test would find no pairing left in it and exempt the block. The cost of
 * the strict reading is stated: a future publication that legitimately reads the count has to write
 * the rule id in the same sentence as the number, which is the wording an organizer can check
 * anyway.
 *
 * EVERY RULE THE CLAIM NAMES HAS TO LICENSE IT, which is the fifteenth PR #247 round. This asked
 * whether SOME attributed rule was named and supported the numbers, so the first legitimate rule in
 * a sentence licensed the whole sentence: with `HEALTH-ASSEMBLY-001` published at 75,
 * "HEALTH-ASSEMBLY-001 and DOHMH-VENDOR-PERMIT-001 are required at 75 guests." was exempt, and the
 * vendor rule's trigger reads no count at all. A sentence naming two rules asserts the count of
 * BOTH of them, so the quantifier is `every` over the subjects and a subject that publishes nothing
 * licenses nothing.
 *
 * THE SUBJECTS ARE FOUND IN THE WHOLE PUBLISHED ID SPACE and not in `attributed` alone, which is
 * what makes that quantifier bite: a rule whose trigger reads no count is absent from `attributed`,
 * so searching only its keys would never see the second name and `every` would range over one
 * subject again. `publishedIds` is the caller's list of every id the artifact publishes.
 *
 * A NAMED INSTRUMENT IS A NAMED RULE, which is the twenty-second PR #247 round. A published
 * instrument title is a claim SUBJECT everywhere else in this module, and it was no subject here:
 * `named` read rule IDS alone, so a claim naming another rule's instrument found nothing and fell
 * through to the host, which then licensed it on its own threshold. `instruments` is
 * `publishedInstrumentOwners`' map from an identity to the rules that publish it, and a rule named
 * that way is held to its own trigger exactly as one named by id is: an instrument whose owner
 * reads no count licenses no count, wherever the sentence sits.
 *
 * `host` is the rule whose own output the text is, where there is one. A string that names no rule
 * is about the rule it sits in, which is the only place LOCATION is read as the subject; a string
 * that names rules is about the rules it names, the host included when the host is one of them.
 * Repository prose has no host, so a count sentence naming no rule stays unattributed there.
 */
export const countsAttributed = (
  raw,
  attributed,
  { publishedIds = [], host, instruments = new Map() } = {},
) => {
  const universe = [...new Set([...publishedIds, ...attributed.keys()])];
  const licenses = (claim, id) => {
    const thresholds = attributed.get(id);
    return thresholds !== undefined && countsSupportedBy(claim, thresholds);
  };
  // The rules a claim names by INSTRUMENT TITLE. The titles are normalized the way the claim is,
  // so this is the plain substring question `publishedClaimSubjects` already matches them by.
  const ownersNamed = (claim) => {
    const text = claim.toLowerCase();
    const found = [];
    for (const [title, ids] of instruments) {
      if (text.includes(title.toLowerCase())) found.push(...ids);
    }
    return found;
  };
  // One host or several: a merged dedupe card is published by every rule in its group, so the
  // fallback is a list. For a single host the two quantifiers below coincide, which is why this
  // changed no verdict anywhere else.
  const hosts = host === undefined ? [] : [host].flat();
  const claims = sentencesOf(normalizeForMatching(raw)).filter(statesACount);
  return (
    claims.length > 0 &&
    claims.every((claim) => {
      const named = [
        ...new Set([...universe.filter((id) => namesRule(claim, id)), ...ownersNamed(claim)]),
      ];
      // EVERY named rule has to license the claim, because a claim naming two rules asserts the
      // count of both. Where it names none, SOME host has to: location is all the audit has there,
      // and a card's location is every route published on it.
      if (named.length > 0) return named.every((id) => licenses(claim, id));
      return hosts.length > 0 && hosts.some((id) => licenses(claim, id));
    })
  );
};

/**
 * Every block of one file that pairs the city health agency with an attendee count, within one
 * block or ACROSS THE BOUNDARY between two adjacent blocks.
 *
 * Both sites this defect has actually taken were one block, but the reviewer's split injection put
 * the agency in one block and the count in the next and walked past a block-only scan.
 *
 * A PAIR IS A FINDING ONLY WHEN THE BOUNDARY CONTRIBUTES: one block supplies the agency and the
 * other supplies the count (`splitAcrossBoundary` above). It used to be "the concatenation pairs",
 * which is true whenever EITHER block pairs on its own, so the pass had to be suppressed around any
 * self-pairing block to avoid reporting one claim three times. The sixth PR #247 round's item 3 is
 * what that suppression cost: it blanked BOTH boundaries of every block whose own pairing is then
 * exempted at the reporting site, which on this tree is 8 boundaries at the four pinned records and
 * 2 at the live opt-out block in `apps/api/src/rsvps.test.ts`. A count half planted in the
 * paragraph directly after the pinned 2026-08-03 decision record went unreported for that reason.
 * A pin says "this exact text is present and unchanged"; it never said "and the two boundaries
 * around it are not scanned".
 *
 * The opt-out is the same shape and gets the same treatment: it exempts the block it marks, which
 * is the block whose author took on the obligation to assert the independence, and it does not
 * exempt that block's boundaries with its neighbours.
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
 * A LIST ITEM IS READ AGAINST THE HEADING IT SITS UNDER, which is the twentieth PR #247 round and
 * is the ordinary-English tier's one exception to "two paragraphs". `## DOHMH requirements` over
 * `- Required for 75 guests` is the markdown spelling of the rendered heading-and-point pair that
 * `countClaimsInPublishedOutput` already reads as one unit, and the paragraph predicate refused it
 * because the bullet is not a paragraph, so a tracked document could publish an unsupported trigger
 * in the commonest layout a requirements list has.
 *
 * A HEADING IS NOT A NEIGHBOUR, WHICH IS WHY THIS IS NOT THE FOURTH ROUND'S REVERTED CHANGE. That
 * round paired any two adjacent blocks and cost more than it caught, because two adjacent bullets
 * are two independent rows that happen to touch. A heading is the opposite relation: every item
 * below it is written under it, so the pairing is the document's own structure rather than
 * proximity. That is also why the scope is a RUN of list items rather than the first one, and why
 * it ends at the first paragraph, table row or heading, and why no pairing between two list items
 * is added: the heading has to supply one half of every pair it licenses.
 *
 * Measured over every scanned root: this flags nothing new on this tree, so `BENIGN_ADJACENT_PAIRS`
 * does not move.
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
 *   - Dropping it in prose costs SIX false positives on this tree as of this commit, all adjacent
 *     pairs of unrelated true statements, and they are named and pinned in `BENIGN_ADJACENT_PAIRS`
 *     below with the reason each is two facts rather than one claim. Four were the fifth round's
 *     measurement; the other two are the two boundaries of the pinned `specs/F-302` rationale
 *     paragraph, which became visible when the sixth round stopped letting a pinned block swallow
 *     them. Six is this tree, not a bound: see that list's header for the standing cost.
 *     `docs/VERIFICATION-SOURCES.md` items 8 and 9, the
 *     candidate the fourth round named at 121 characters apart, is NOT among them: it is two
 *     numbered list items, so it is the ordinary-English tier, which the paragraph filter still
 *     excludes. That false positive was avoided by one character under the old bound and is
 *     avoided structurally now.
 *   - Dropping it in code as well would cost EIGHT more, re-measured this round and READ this
 *     round rather than taken on the previous round's word: six adjacent `describe`/`it` pairs in
 *     `packages/engine/src/acceptance.test.ts`, one adjacent pair in `apps/api/src/plan.test.ts`,
 *     and the `CONF-NO-FOOD-001` case block that `BOUNDED_EXTENSIONS` above already names. Every
 *     one of the eight is the shape the in-block bound exists for and carries no claim: the agency
 *     appears as a rule ID being asserted on (`DOHMH-ORGANIZER-NOTIFY-001`) or as a citation
 *     label, and the number is an `EventIntake` fixture's `headcount` field, in a neighbouring
 *     literal with nothing but test scaffolding between them. So the bound stays in code, minus
 *     the files `UNBOUNDED_RECORD_FILES` names.
 */
export function scanFile(
  text,
  { bounded = false, allowOptOut = false, optOutDigests = [], subjects = [] } = {},
) {
  const subject = claimSubject(subjects);
  // The marker says the author took the obligation on; the digest says this is the block that was
  // read against it. Both, or the block is scanned like any other.
  const optedOut = (block) =>
    allowOptOut && block.includes(OPT_OUT_MARKER) && optOutDigests.includes(blockDigest(block));
  // Empty blocks are dropped so that ADJACENT means "nothing between them but whitespace". A
  // paragraph followed by a blank line and then a bullet produces an empty block in between, and
  // that is the third of the structural shapes the fourth PR #247 round found: with the empty
  // block counted, the paragraph's neighbour was the blank line and the bullet was never paired
  // with it. A block that separates two others still separates them; a blank line never did.
  const blocks = blocksOf(text).filter((block) => block.trim() !== "");
  // Matching reads each block as one line of prose; the flagged text stays RAW, because that is
  // what a pin digests. See `normalizeForMatching`.
  const matchable = blocks.map(normalizeForMatching);
  const flagged = [];
  // The heading the block under consideration sits below, while nothing but list items separates
  // them. `undefined` as soon as any other block intervenes: a heading scopes the list written
  // under it and stops scoping at the first paragraph, table row or heading that follows.
  let heading;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = matchable[index];
    const next = matchable[index + 1];
    if (!optedOut(blocks[index]) && pairsAgencyWithCount(block, { bounded, subjects })) {
      flagged.push({ kind: "block", text: blocks[index] });
    }
    if (isHeading(blocks[index])) heading = index;
    else if (!isListItem(blocks[index])) heading = undefined;
    if (next === undefined) continue;
    // WHICH BLOCK THE ORDINARY-ENGLISH TIER READS THE NEXT ONE AGAINST: the block before it where
    // both are paragraphs, and the heading above it where it is a list item under one. Undefined
    // where neither holds, which is every list item under no heading and every table row.
    const scoping = isParagraph(blocks[index + 1])
      ? isParagraph(blocks[index])
        ? index
        : undefined
      : isListItem(blocks[index + 1])
        ? heading
        : undefined;
    const pair = `${block}\n${next}`;
    // The distance bound, where the file kind asks for it, is still measured over the pair. It is
    // a NECESSARY condition here rather than the whole test: what makes a pair a cross-boundary
    // finding is `splitAcrossBoundary`, and the bound only asks that the two halves also sit close
    // enough together to be read as one claim.
    const withinBound = (near, text = pair) => !bounded || near.test(text);
    const acrossAnyBlocks =
      splitAcrossBoundary(block, next, ATTENDEE_COUNT, subject.pattern) &&
      withinBound(subject.nearAttendeeCount);
    const acrossOrdinaryEnglish =
      scoping !== undefined &&
      splitAcrossBoundary(matchable[scoping], next, COUNTED_PEOPLE, subject.pattern) &&
      withinBound(subject.nearAnyCount, `${matchable[scoping]}\n${next}`);
    if (acrossAnyBlocks || acrossOrdinaryEnglish) {
      // The pair as it reads: the two blocks the halves actually sit in.
      const first = acrossAnyBlocks ? index : scoping;
      flagged.push({ kind: "pair", text: `${blocks[first]}\n${blocks[index + 1]}` });
    }
  }
  return flagged;
}

/** The rule id or published agency that makes a rule the city health agency's. */
export const cityHealthRule = ({ id = "", output }) =>
  CITY_HEALTH_AGENCY.test(id) || CITY_HEALTH_AGENCY.test(output?.agency ?? "");

/**
 * Whether a contract field holds a LOCATOR rather than prose: a key whose name ends in `url` or
 * `urls`, however it is spelled. This is the twenty-second PR #247 round.
 *
 * The exclusion was the exact key `url` and no other, so the ARRAY form the repository actually
 * writes was read as prose: `sources[].urls` is this tree's normal shape, it sits beside the
 * citation in one object, and `siblingUnits` therefore joins a real URL to a real citation into one
 * unit. `{ citation: "DOHMH permit page", urls: ["https://example.test/75-guests"] }` came out of
 * that as a fabricated count claim, so adding a legitimate source locator to a rule broke the
 * regulatory-artifact audit on an edit that published nothing. A false report on ordinary work
 * costs this guard more than the claim it cannot make: a path is not a sentence, and no organizer
 * reads one as a threshold.
 *
 * The question is the KEY and not the value, on the same terms the exact-key check asked it: a
 * string that merely looks like a URL may still be prose an author wrote, and a contract field
 * named for a locator holds a locator. `portalUrl` and `source_urls` are the other two spellings
 * this tree's artifacts carry, and both are now answered by the same rule rather than by two more
 * entries somebody has to remember.
 */
const isUrlField = (key) => /urls?$/i.test(key);

/**
 * Every organizer-facing string a published rule or advisory carries, at any nesting depth of its
 * `output`: `permit_name`, `requirement_name`, `note_text`, `advisory_text`, `disposition`, the
 * `notes` array, the `deadline` and `fee` displays, and every `user_summary` heading and point.
 *
 * A URL is not prose and is excluded: it carries no claim, and a path fragment like
 * `.../guests-75` would read as a count. Everything else under `output` is read, rather than the
 * dozen keys that exist today, so a key a future publication adds is scanned the day it lands.
 */
export const outputStrings = (node, into = []) => {
  if (typeof node === "string") into.push(node);
  else if (Array.isArray(node)) for (const child of node) outputStrings(child, into);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (!isUrlField(key)) outputStrings(value, into);
    }
  }
  return into;
};

/**
 * Every organizer-facing string one published rule or advisory carries: its whole `output`, plus
 * the two strings that sit OUTSIDE `output` and reach organizers all the same, the VERIFICATION
 * QUALIFICATION and the SOURCE CITATION.
 *
 * The qualification was outside this audit until the twelfth PR #247 round, and it is not an
 * internal note: `packages/engine/src/findings.ts:55-64` appends it to every finding's `notes`
 * alongside the rule's own, and `apps/web/app/plan/plan-line.tsx:366-369` renders those notes as
 * paragraphs of the finding. So a sentence such as "DOHMH requires a permit at 75 or more guests"
 * written there is published to an organizer exactly as a `note_text` is, and this audit named no
 * offender for it. Nine of this ruleset's rules publish one today.
 *
 * The citation is the thirteenth round, and it is the same shape one field over.
 * `packages/engine/src/findings.ts:68-71` copies `source.citation` verbatim into every finding's
 * `sources`, and `apps/web/app/plan/plan-line.tsx:117-123` renders it verbatim as the plan line's
 * citation text. A citation reading "DOHMH permit for 75 or more guests" is therefore an
 * unsupported trigger printed on the plan line itself, and this audit named no offender for it.
 * Forty-four of this ruleset's rules and advisories publish a citation.
 *
 * `source.urls` is not here, for the reason `outputStrings` gives about `url`: a path fragment
 * like `.../guests-75` is not prose and would read as a count.
 *
 * `verification.status` and `verification.evidence` are not here either. The status is an
 * enumerated value that renderers own, and the evidence is a research reference ("VS Round2 #2")
 * the engine never puts in a finding.
 */
export const organizerFacingStrings = (rule) => [
  ...outputStrings(rule.output),
  ...(typeof rule.verification?.qualification === "string"
    ? [rule.verification.qualification]
    : []),
  ...(typeof rule.source?.citation === "string" ? [rule.source.citation] : []),
];

/**
 * What joins two of a rule's strings when the rule is read as the one card an organizer sees.
 *
 * A PERIOD AND A SPACE, so the join cannot invent a phrase that neither string carries: the seam
 * ends a sentence, which is the bound `COUNTED_PEOPLE`'s noun-first alternation already respects,
 * so a count noun at the end of a heading is not read against a numeral at the start of the point
 * under it. What the join is for is the AGENCY-to-COUNT pairing across the two, which is the
 * relationship a per-string scan cannot see.
 */
const RENDERED_SEPARATOR = ". ";

/**
 * The two arrays whose strings `countClaimsInPublishedOutput` reads RULE BY RULE, and which
 * `rulesetProseStrings` therefore skips rather than reading a second time.
 */
const PUBLISHED_RULE_ARRAYS = ["rules", "advisories"];

/**
 * The strings one object of the artifact carries DIRECTLY, its arrays of strings included: the
 * siblings a reader sees as one labelled thing. A child object is a unit of its own, so nesting
 * groups rather than flattens, and a URL field is excluded for the reason `isUrlField` gives.
 */
const siblingUnits = (node, into = []) => {
  if (typeof node === "string") into.push([node]);
  else if (node && typeof node === "object") {
    const siblings = [];
    const collect = (value) => {
      if (typeof value === "string") siblings.push(value);
      else if (Array.isArray(value)) for (const child of value) collect(child);
      else if (value && typeof value === "object") siblingUnits(value, into);
    };
    for (const [key, value] of Object.entries(node)) {
      if (!isUrlField(key)) collect(value);
    }
    if (siblings.length > 0) into.push(siblings);
  }
  return into;
};

/**
 * THE ARTIFACT'S OWN TOP-LEVEL PROSE: every string the published ruleset carries outside its
 * `rules` and `advisories`, grouped into the UNITS a reader reads them in and labelled by the
 * top-level key each unit hangs under.
 *
 * EVERY OTHER KEY, not a list of the regulatory-looking ones, for the reason `outputStrings` gives
 * about `output`: a key a future publication adds is scanned the day it lands rather than the day
 * somebody remembers to extend a list. `status`, `provenance` and `status_legend` are the three the
 * thread names and the three the F-302 rollout spec requires rewriting, but `config`,
 * `intake_fields`, `engine_conventions` and `reference_tables` all carry regulatory sentences too,
 * and `config.slack_warning_days.note` already exists to say a threshold is NOT an official one.
 *
 * A UNIT AND NOT A FLAT LIST OF STRINGS, which is the fifteenth PR #247 round. This flattened the
 * whole subtree and handed each string to the scan alone, so structured published prose reassembled
 * the twelfth round's defect one level up: `status_legend: { heading: "DOHMH requirements",
 * description: "Required at 75 or more guests" }` puts the agency in one value and the trigger in
 * its sibling, neither value carries both, and the audit named no offender for a legend an
 * organizer reads as one line. A rule's strings were already joined into a semantic unit for
 * exactly this reason; nothing did it here.
 *
 * THE UNIT IS THE ENCLOSING OBJECT rather than the whole top-level key, and the artifact decides
 * that the way `provenance` decided `countClaimsInProse`'s unit. `config`, `intake_fields` and
 * `reference_tables` are trees of unrelated sub-objects, so joining a whole key would read a
 * sentence of one table against a sentence of the next, which is co-occurrence and not a claim.
 * Sibling values under one object are the smallest group a reader sees as one thing, and it is the
 * group the thread's example is.
 */
export const rulesetProseStrings = (artifact) => {
  const found = [];
  for (const [key, value] of Object.entries(artifact ?? {})) {
    if (PUBLISHED_RULE_ARRAYS.includes(key)) continue;
    for (const strings of siblingUnits(value)) found.push({ where: `ruleset.${key}`, strings });
  }
  return found;
};

/**
 * Every part of one top-level string that pairs the city health agency with an attendee count,
 * READ SENTENCE BY SENTENCE and across the boundary between two adjacent sentences.
 *
 * THE UNIT IS THE SENTENCE, not the whole string, and the artifact forces that choice rather than
 * taste deciding it. A rule's `note_text` is one authored claim, so pairing across it is the claim;
 * `provenance` is a version-by-version changelog held in a single JSON string with no blank line in
 * it, so `blocksOf` returns it whole and pairing across it is co-occurrence. On the published
 * artifact today that difference is the difference between zero offenders and one: the sentence
 * quoting the answer key's "venue-occupancy advisory + DOHMH findings remain" and a sentence about
 * a guest count sit some two thousand characters apart in `provenance`, and a whole-string scan
 * reports the pair as a fabricated regulatory claim. This is the same reasoning `countsAttributed`
 * states for its own unit, applied to the other side of the question.
 *
 * AND THE ADJACENT PAIR, because the sentence alone has the hole the twelfth round found between
 * two strings of one card: "DOHMH publishes this requirement. It applies at 75 or more guests."
 * carries the agency in one sentence and the count in the next and neither sentence carries both.
 * `splitAcrossBoundary` is the same predicate the block scan uses, and it asks that the boundary
 * CONTRIBUTE, so a self-pairing sentence is not reported three times.
 *
 * A SELF-PAIRING SENTENCE NO LONGER SKIPS ITS FORWARD BOUNDARY, which is the fourteenth PR #247
 * round. Flagging the sentence used to `continue`, so the boundary with the next sentence went
 * unread whenever the current one paired alone, and the next sentence's half was then read by
 * nobody. On a rule legitimately publishing 75, "HEALTH-ASSEMBLY-001, published by DOHMH, applies
 * at 75 guests. The vendor permit starts at 500 guests." emitted only the first sentence, which
 * `countsAttributed` then exempts because it names the rule and states the rule's own number; the
 * unsupported 500 was never carried into an offender at all. The boundary is read either way now.
 *
 * The cost is stated rather than suppressed: two ADJACENT sentences that each pair alone now
 * produce three entries, the two sentences and the pair between them. Suppressing the pair when
 * the neighbour pairs alone would reopen this same hole in the other direction, where the
 * neighbour carries the whole claim and the sentence before it carries a dangling count, so the
 * duplicate is preferred to the miss. Every entry names a real offender either way; what a
 * duplicate costs is a repeated line in a failure message.
 *
 * Sentences are split RAW and matched normalized, which is what `flaggedBlocks` does with blocks:
 * the reported text is the text a reader will search the artifact for.
 */
const countClaimsInProse = (raw, subjects = []) => {
  const sentences = sentencesOf(raw);
  const matchable = sentences.map(normalizeForMatching);
  const subject = claimSubject(subjects);
  const flagged = [];
  for (let index = 0; index < sentences.length; index += 1) {
    if (pairsAgencyWithCount(sentences[index], { subjects })) flagged.push(sentences[index]);
    const next = matchable[index + 1];
    if (next === undefined) continue;
    const acrossBoundary =
      splitAcrossBoundary(matchable[index], next, ATTENDEE_COUNT, subject.pattern) ||
      splitAcrossBoundary(matchable[index], next, COUNTED_PEOPLE, subject.pattern);
    if (acrossBoundary) flagged.push(`${sentences[index]} ${sentences[index + 1]}`);
  }
  return flagged;
};

/**
 * THE PUBLISHED RULESET'S OWN PROSE, scanned: every string of every rule's and advisory's `output`
 * that states a count-based city health requirement. This is the tenth PR #247 round.
 *
 * The prose walk covered `.md`, `.ts`, `.tsx`, `.mjs` and `.js`, and the only JSON anything read was
 * the TRIGGER of each rule. So the artifact at the top of AGENTS.md's authority order was the one
 * prose artifact nobody scanned. A publication that left every DOHMH trigger food-based and added a
 * `note_text` or a `user_summary` point saying the requirement depends on the headcount kept every
 * assertion green while shipping the unsupported claim straight to organizers, which is further
 * than any document this guard does scan can reach.
 *
 * TWO QUESTIONS, because a rule's strings are attributable to the rule in a way a document's are
 * not:
 *
 *   - A CITY HEALTH RULE's own output may not carry an attendee count at all. The string sits
 *     inside the requirement, so it needs no agency name of its own to be a claim about that
 *     agency; `output.agency` supplies it. The agency name is prefixed to the string here so that
 *     both questions go through `pairsAgencyWithCount` rather than through two near-copies of it.
 *   - ANY rule's output may not PAIR the city health agency with a count, which is the same
 *     question the prose scan asks of a document block. This is what catches a Parks or DOB rule
 *     whose note says a DOHMH requirement is count-based.
 *
 * `attributed` maps a rule id to THE THRESHOLDS ITS PUBLISHED TRIGGER ACTUALLY READS the count
 * against. It is empty on this tree and is passed in rather than decided here, because the trigger
 * is the caller's parse.
 *
 * A RULE THAT READS THE COUNT IS NOT EXEMPT FROM THE AUDIT, which is the eleventh PR #247 round.
 * Membership alone used to skip the rule outright, so the day a city health rule legitimately
 * gained a count trigger, every organizer-facing string on it stopped being read. A rule triggered
 * at 75 guests could then publish a note saying its permit starts at 500 guests and this audit
 * would name no offender, which is an unsupported threshold shipping under the cover of a supported
 * field. What the trigger licenses is the FIELD, and `countsSupportedBy` below is the narrower
 * question the strings are held to instead: a claim may state a number the rule really publishes
 * and no other.
 *
 * THE DIRECTION OF AN INCLUSIVE THRESHOLD IS NOT COMPARED, and that is a declared limit rather than
 * an oversight. A rule triggered at `gte` 75 whose note says the permit applies BELOW 75 guests
 * states a number the rule really applies at, and passes here. Reading the direction out of every
 * claim means matching a verb against a list, which is the denylist shape
 * `spec-conflict-resolutions.test.mjs` records this branch removing from this guard once already,
 * and it leaked then. The number is what an organizer acts on and it is what is checked.
 *
 * AN EXCLUSIVE THRESHOLD IS THE ONE CASE THAT NARROWS, which is the twenty-third PR #247 round. On
 * `gt 75` the rule applies above 75 and NOT at it, so the numeral alone said nothing about whether
 * the claim matched the published trigger, and "applies at 75 guests" was licensed by a rule that
 * excludes 75. `countsSupportedBy` states why reading a relation there is the opposite of the
 * denylist: it decides an EXEMPTION, so an unlisted wording is reported rather than missed.
 *
 * THE RULE IS READ AS ONE RENDERED UNIT AND NOT AS A LIST OF INDEPENDENT STRINGS, which is the
 * twelfth PR #247 round. Each string used to be scanned alone, so a claim whose two halves sat in
 * two of them produced no offender: a `user_summary` heading reading "DOHMH requirements" over a
 * point reading "Required at 75 or more guests" names the agency in one string and the count in the
 * other, and neither string carries both. `apps/web/app/plan/plan-line.tsx:204-243` renders the
 * heading and every point of one finding inside one `article`, so an organizer reads them as one
 * requirement, which is what makes the pair a claim.
 *
 * SO EVERY STRING IS SCANNED FIRST AND THE UNIT SECOND, in that order, and the unit is reported
 * only when no single string of it is. That is what keeps the report at the granularity of the
 * offending sentence wherever one string carries the whole claim, which is every case this audit
 * has had, and widens it to the card only where the claim is the relationship between two strings.
 *
 * THE ARTIFACT'S OWN TOP-LEVEL PROSE IS READ TOO, which is the thirteenth PR #247 round. This
 * walked `rules` and `advisories` and nothing else, and the generic prose walk excludes `.json`
 * entirely, so `status`, `provenance`, `status_legend` and every other top-level string were the
 * one part of the highest-authority artifact that no guard in this repository read. That is not a
 * hypothetical corner: the changed F-302 rollout spec requires rewriting `status` and
 * `provenance`, so those are strings this branch's own work edits. `rulesetProseStrings` below
 * says which strings and `countClaimsInProse` says at what unit.
 *
 * A CLAIM THAT NAMES ANOTHER RULE IS AUDITED AGAINST THAT RULE, which is the fourteenth PR #247
 * round. The hosting rule's own thresholds used to license every string the rule carries, which
 * reads a string's LOCATION as its subject. They are not the same thing: a city health rule
 * legitimately triggered at 75 could publish "DOHMH-VENDOR-PERMIT-001 depends on the guest count."
 * and pass, because the sentence states no numeral and an empty set of claimed counts is supported
 * by anything, and it could publish "DOHMH-VENDOR-PERMIT-001 applies at 75 guests." and pass on the
 * host's own number, while the named rule's trigger reads no count at all. Where a string names
 * rules other than its host, every one of them has to license it, and a named rule whose trigger
 * reads no count licenses nothing. `namesRule` is the token match, so a companion id sharing the
 * base does not stand in for the rule it extends.
 *
 * THE HOST IS ONE OF THE SUBJECTS RATHER THAN THE BRANCH NOT TAKEN, which is the fifteenth PR #247
 * round. The named-rule branch filtered the host id OUT and then never validated the claim against
 * the host's own thresholds, so naming a second rule bought an exemption from the first: a host
 * legitimately published at 75 could say "HEALTH-A applies at 500 guests, like HEALTH-B" and pass
 * on HEALTH-B's 500, which is an invented threshold printed under the name of the rule that does
 * not publish it. The host is dropped from the subjects only where the string names no rule at all,
 * which is the one case where location is all the audit has. `countsAttributed` is the single
 * predicate for both questions now, so the repository scan and this audit cannot disagree about
 * what licenses a count.
 *
 * THE SUBJECTS AN ARTIFACT DOES NOT PUBLISH ARE THE CALLER'S TO SUPPLY, which is the twentieth PR
 * #247 round. The subject set was `publishedClaimSubjects(artifact)` and nothing else, which reads
 * every artifact as its own authority. That is right for the published ruleset and wrong for
 * everything below it: a finding fixture carries no `rules` and no `advisories`, so its subject set
 * was empty, and "A Temporary Food Service Establishment permit is required for 75 guests." named
 * an instrument identity that comes from the PUBLISHED ruleset, in an organizer-facing artifact one
 * level down, and produced no offender. The instrument's identity does not belong to the file that
 * mentions it. `subjects` is unioned with the artifact's own rather than replacing them, so a
 * superseded or proposed ruleset is still read against the instruments it publishes itself.
 *
 * A DEDUPE GROUP RENDERS AS ONE CARD AND IS AUDITED AS ONE, which is the twenty-third PR #247
 * round. Rules sharing an `output.dedupe_key` are alternative published routes to one requirement,
 * and `packages/engine/src/findings.ts:437` and `:461` merge them into a single finding: the
 * `user_summary` points and the `notes` of every member are concatenated onto one card under one
 * heading. This audit read each rule alone, so the two halves of a claim could sit in two members
 * and neither member carried both: a city health rule supplying the heading beside another route
 * supplying "Required at 75 guests" produced no offender for either rule while the merged card
 * published the unsupported threshold. The headcount-independence assertion stays green through it
 * too, because both triggers can be count-independent and the claim is in the prose rather than in
 * a trigger.
 *
 * THE GROUP IS THE THIRD UNIT AND NOT A REPLACEMENT FOR THE OTHER TWO, in the same order and for
 * the same reason: string, then the rule's own card, then the group's card, each reported only
 * where the narrower one is silent. That keeps the report on the offending sentence wherever one
 * string carries the claim and widens it to the merged card only where the claim is the
 * relationship between two routes.
 *
 * THE MERGE ORDER IS NOT REPRODUCED, and it does not need to be: what this asks is whether the two
 * halves reach one card, which the concatenation settles whichever route binds the identity. The
 * agency prefix is the group's own city health member's, because a merged card carries one agency
 * and the routes are alternatives to one requirement.
 *
 * A GROUP CLAIM NAMING NO RULE IS LICENSED BY ANY ROUTE THAT PUBLISHES ITS NUMBER, which is the one
 * place `countsAttributed`'s host fallback ranges over more than one id. Requiring every member to
 * license it would report a legitimate count-reading route the moment it shared a card with a
 * count-independent one, which is an ordinary publication rather than a claim.
 *
 * Measured on this tree: zero strings and zero units, over 42 rules and 4 advisories, with the
 * verification qualifications and the source citations included, and zero top-level units. The
 * published ruleset carries exactly ONE multi-member dedupe group, `dob-structure`
 * (`DOB-TENT-001` and `DOB-TALL-STRUCTURE-001`), and it reports nothing: both routes are DOB's.
 * The named-rule branch changes no verdict here, because no rule on this tree is attributed at all.
 */

/**
 * The published rules grouped by `output.dedupe_key`, keeping only the groups with more than one
 * member. A key with one member renders as the card that rule already is, which the loop above
 * has read since the twelfth round.
 */
export const dedupeGroups = (rules) => {
  const groups = new Map();
  for (const rule of rules) {
    const key = rule.output?.dedupe_key;
    if (typeof key !== "string" || key === "") continue;
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }
  return [...groups].filter(([, members]) => members.length > 1);
};

export const countClaimsInPublishedOutput = (
  artifact,
  { attributed = new Map(), subjects: given = [] } = {},
) => {
  const found = [];
  const publishedRules = [...(artifact.rules ?? []), ...(artifact.advisories ?? [])];
  const publishedIds = publishedRules.map((rule) => rule.id).filter(Boolean);
  // The artifact's own identities, plus whatever the caller says is published elsewhere. The
  // artifact's own are what let this audit read a ruleset without being told anything; `subjects`
  // is what a LOWER-AUTHORITY artifact needs, and it is the caller's answer because only the
  // caller knows which artifact in the tree is the publication.
  const subjects = [...new Set([...publishedClaimSubjects(artifact), ...given])].sort();
  // Which rule of THIS artifact publishes each instrument title, so a claim naming another rule's
  // instrument is audited against that rule rather than against the one it happens to sit in. The
  // map is the artifact's own and is not widened by `given`: a title the caller supplies belongs to
  // a rule of some other artifact, whose id this artifact's claim cannot be held to, and a claim
  // naming one is already reported here because it names no rule of this artifact at all.
  const instruments = publishedInstrumentOwners(artifact);
  for (const rule of publishedRules) {
    const ownRequirement = cityHealthRule(rule);
    const claims = (string) => {
      const scanned = ownRequirement ? `${rule.output?.agency ?? "DOHMH"}. ${string}` : string;
      if (!pairsAgencyWithCount(scanned, { subjects })) return false;
      return !countsAttributed(scanned, attributed, { publishedIds, host: rule.id, instruments });
    };
    const strings = organizerFacingStrings(rule);
    const offending = strings.filter(claims);
    const unit = strings.join(RENDERED_SEPARATOR);
    if (offending.length > 0) {
      for (const string of offending) found.push({ ruleId: rule.id, string });
    } else if (claims(unit)) {
      found.push({ ruleId: rule.id, string: unit });
    }
  }
  // The card a dedupe group renders as, read as one unit, on the same terms and in the same order
  // as a single rule's card: a group unit is reported only where no member's own string or card is.
  const reported = new Set(found.map((entry) => entry.string));
  for (const [key, members] of dedupeGroups(publishedRules)) {
    const strings = members.flatMap(organizerFacingStrings);
    const unit = strings.join(RENDERED_SEPARATOR);
    if (strings.some((string) => reported.has(string)) || reported.has(unit)) continue;
    // The agency of the group's own city health member, where it has one. A merged card carries one
    // agency and the group's routes are alternatives to one requirement, so the first is the card's.
    const health = members.find(cityHealthRule);
    const scanned = health ? `${health.output?.agency ?? "DOHMH"}. ${unit}` : unit;
    if (!pairsAgencyWithCount(scanned, { subjects })) continue;
    const hosts = members.map((rule) => rule.id).filter(Boolean);
    if (countsAttributed(scanned, attributed, { publishedIds, host: hosts, instruments })) continue;
    found.push({ ruleId: `dedupe:${key}`, string: unit });
  }
  // Top-level prose is read string by string and then as the unit its siblings make, in that
  // order and on the same terms as a rule's card: the unit is reported only where no single string
  // of it is, so the report stays at the offending sentence wherever one string carries the claim.
  for (const { where, strings } of rulesetProseStrings(artifact)) {
    const unreported = (text) =>
      countClaimsInProse(text, subjects).filter(
        (claim) => !countsAttributed(claim, attributed, { publishedIds, instruments }),
      );
    const offending = strings.flatMap(unreported);
    const reported =
      offending.length > 0 ? offending : unreported(strings.join(RENDERED_SEPARATOR));
    for (const claim of reported) found.push({ ruleId: where, string: claim });
  }
  return found;
};

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
 * THE FALSE-POSITIVE COST of running the cross-boundary pass unbounded in prose, measured on this
 * tree: SIX adjacent pairs as of this commit, each two unrelated true statements that happen to sit
 * next to each other. AND ONE NEW ENTRY PER FUTURE ADJACENCY, which is the part the fourth and
 * fifth rounds' "the measured cost is four" did not say and the sixth round's item 4 corrected.
 *
 * The six are a snapshot of this tree, not a bound on the design. Over the 50 scanned `.md` files
 * (6,793 blocks) there are 85 blocks naming the city health agency, 81 of which carry no count, and
 * 146 blocks carrying a count word. Any true, agency-free new block carrying a count word that
 * lands beside one of those 81 is a seventh entry, and its author had nothing to do with either
 * fact. That is the standing price of the pass, and the offender message in
 * `spec-conflict-resolutions.test.mjs` has a branch that says so to whoever trips it: an entry here
 * is an ordinary cost of the pass, unlike a fifth `HISTORICAL_RECORDS` pin, which is a governance
 * action.
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
    file: "specs/F-302-rsvp-guest-list.md",
    pair: "Acceptance Criterion 2 and the rationale paragraph under it",
    anchor: "2. **Capacity-aware (amended 2026-08-03, product-owner approved,",
    sha256: "4e569c5a64221d00f048a91f35f7608c39eeb63d47ab91e2829bc98ba5dd4dab",
    why:
      "The criterion names the pre-rename response key `headcount` and says in terms that admission" +
      " never reads it; the block under it is the pinned historical rationale, which is where the" +
      " agency name comes from. Both boundaries of that pin became visible in the sixth PR #247" +
      " round, and this is one of them: the criterion carries no claim, and the pin's own words are" +
      " protected and corrected elsewhere.",
  },
  {
    file: "specs/F-302-rsvp-guest-list.md",
    pair: "the pinned rationale paragraph and the rollout compatibility window under it",
    anchor: "Admission was F-101 `headcount` until this amendment.",
    sha256: "8c6745330d2a20ebcaf95045f0ac4a79bf3399c8323bdeb346ced3ecf13b59c1",
    why:
      "The pin's other boundary. The block under it is the 2026-08-05 rollout window, which names" +
      " `event.headcount` as the pre-rename NAME a stale web build reads and states that it carries" +
      " the enforced limit rather than the column. A deployment-order fact and a superseded" +
      " rationale, sharing a boundary and no claim.",
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

/** One block's SHA-256, over its raw text. */
export const blockDigest = (block) => createHash("sha256").update(block, "utf8").digest("hex");

/** The text a pin protects: the whole block, minus any part the pin declares unstable. */
export const pinnedDigest = (pin, block) => blockDigest(pin.stable ? pin.stable(block) : block);
