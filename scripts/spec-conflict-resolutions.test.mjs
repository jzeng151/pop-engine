import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  BENIGN_ADJACENT_PAIRS,
  HISTORICAL_RECORDS,
  OPT_OUT_EXTENSIONS,
  OPT_OUT_MARKER,
  blocksOf,
  pinnedDigest,
  scanFile,
  scanOptionsFor,
} from "./spec-conflict-scan.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");

/**
 * These guard the three SPEC-CONFLICT resolutions ratified on 2026-08-02 (#207, #208, #213).
 *
 * They assert the required shape, never a list of superseded phrasings. Commit e5af61d removed
 * that denylist shape from this repository with the reason attached: "the defect walked around it
 * twice more while the list watched." A banned phrase constrains one wording; the resolution can
 * regress in any other. So where a negative has to be expressed, it is expressed against parsed
 * structure — a section's contents, or an enumeration in the engine — which has no way around it.
 */

/** The body of a markdown `## Section` or `### Section`, up to the next heading of any depth. */
function section(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start < 0) return null;
  const after = markdown.slice(start + heading.length);
  const end = after.search(/\n#{2,3} /);
  return end < 0 ? after : after.slice(0, end);
}

const engineTypesPath = resolve(repoRoot, "packages/engine/src/types.ts");

/**
 * The engine's exported types, RESOLVED by the TypeScript compiler rather than scraped out of the
 * file's text. Two earlier rounds repaired a regex over the declaration's source, and each repair
 * bought one syntax: the character class admitted no digit or hyphen, so a later `permit_v2` would
 * have been dropped from the members silently and the coverage assertion below would have passed
 * over a real gap. Widening the class again buys one more syntax and leaves the rest — single
 * quotes, a comment containing a quoted word inside the declaration, a `;` inside a generic
 * argument, or a union that is not written as a flat list of literals. The compiler has no such
 * shapes to admit: it reads whatever the engine actually declares, so a member is dropped only if
 * the engine does not have it.
 */
let engineTypes;
function engineExports() {
  if (!engineTypes) {
    const program = ts.createProgram([engineTypesPath], {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      lib: ["lib.es2022.d.ts"],
      types: [],
    });
    const checker = program.getTypeChecker();
    const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(engineTypesPath));
    engineTypes = {
      checker,
      exports: new Map(checker.getExportsOfModule(moduleSymbol).map((s) => [s.name, s])),
    };
  }
  return engineTypes;
}

/** Members of a string-union type alias in the engine's types, e.g. `Disposition`. */
function unionMembers(alias) {
  const { checker, exports } = engineExports();
  const symbol = exports.get(alias);
  expect(symbol, `${alias} is exported from packages/engine/src/types.ts`).toBeDefined();
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  const constituents = type.isUnion() ? type.types : [type];
  for (const constituent of constituents) {
    // Also the failure mode when the alias stops resolving at all: an error type is not a string
    // literal, so a broken engine file fails the guard rather than yielding an empty membership.
    expect(
      constituent.isStringLiteral(),
      `${alias} is a union of string literals, not ${checker.typeToString(constituent)}`,
    ).toBe(true);
  }
  return constituents.map((constituent) => constituent.value);
}

/** Every feature ID a passage names, minus the spec's own, which is never its own dependency. */
function otherFeatureIds(text, ownId) {
  const ids = new Set([...text.matchAll(/\bF-\d{3}\b/g)].map((match) => match[0]));
  ids.delete(ownId);
  return ids;
}

describe("SPEC-CONFLICT resolutions ratified 2026-08-02", () => {
  it("#207: F-405 ships its own Phase 2 assignments and does not depend on Phase 3 F-213", () => {
    const roadmap = read("docs/ROADMAP.md");
    const runbook = read("specs/F-405-day-of-runbook.md");

    const f405 = roadmap.indexOf("F-405 · Day-of Runbook");
    const f213 = roadmap.indexOf("F-213 · Team Task Assignment");
    const phase3 = roadmap.indexOf("## Phase 3");
    expect(f405).toBeGreaterThanOrEqual(0);
    expect(f213).toBeGreaterThanOrEqual(0);
    expect(phase3).toBeGreaterThanOrEqual(0);
    expect(f405, "F-405 stays in Phase 2").toBeLessThan(phase3);
    expect(f213, "F-213 stays in Phase 3").toBeGreaterThan(phase3);

    expect(runbook).toContain("F-405 owns the minimal Phase 2 runbook-assignment source");
    expect(runbook).toContain("F-213 remains the Phase 3 general team-task feature");

    // The regression this resolution exists to prevent is a Phase 2 spec depending on a Phase 3
    // one. Checked against the dependency enumeration itself rather than a banned sentence, so it
    // holds however a future edit words it. Two earlier rounds read only the section's first
    // bullet, which a reformat walks around by leaving that bullet alone and declaring F-213
    // lower down. So every bullet is classified instead: the section says in its own text which
    // bullet declares dependencies and which records a deliberate exclusion, and any other bullet
    // that names a feature is an unclassified third place for the dependency to come back.
    const dependencies = section(runbook, "## Dependencies and Baseline");
    expect(dependencies, "F-405 declares its dependencies").not.toBeNull();

    // The section is PARTITIONED, so every character of it lands in exactly one classified block:
    // the text before the first bullet, then one block per bullet running to the next bullet.
    // Two earlier rounds read physical lines instead, so a bullet wrapped onto a continuation
    // naming F-213 sat outside the filter; a third read indented continuations only, which
    // CommonMark's lazy continuation walks around by starting the wrapped line in column one. A
    // block that ends only at the next bullet has no such shape to admit: any line a future edit
    // adds belongs to some block, and every block is checked.
    const blocks = [""];
    for (const line of dependencies.split("\n")) {
      if (line.startsWith("- ")) blocks.push(line);
      else blocks[blocks.length - 1] += " " + line.trim();
    }
    const labelled = (label) => blocks.filter((block) => block.startsWith(`- **${label}:**`));
    const declared = labelled("Depends on");
    const excluded = labelled("Not a dependency");
    expect(declared.length, "F-405 declares its dependencies in one labelled bullet").toBe(1);
    expect(excluded.length, "F-405 records its deliberate exclusions in one labelled bullet").toBe(
      1,
    );

    expect(
      [...otherFeatureIds(declared[0], "F-405")],
      "F-405 declares no dependency on the Phase 3 F-213",
    ).not.toContain("F-213");
    expect(
      [...otherFeatureIds(excluded[0], "F-405")],
      "F-405 records F-213 as deliberately not a dependency",
    ).toContain("F-213");
    for (const block of blocks.filter(
      (item) => !declared.includes(item) && !excluded.includes(item),
    )) {
      expect(
        [...otherFeatureIds(block, "F-405")],
        `an unlabelled part of the section names no feature: ${block}`,
      ).toEqual([]);
    }
  });

  it("#208: permit-burden/v1 partitions every engine enumeration it filters on", async () => {
    const comparator = read("specs/F-103-scope-comparator.md");
    const historical = read("specs/F-502-historical-event-comparison.md");

    // The spec still owns the decision and must keep pointing at the artifact that states it.
    expect(comparator).toContain("docs/proposals/permit-burden-v1.ts");
    expect(comparator).toContain("`{ definite, unresolved }`");
    expect(comparator).toContain("Count each final deduplicated finding once");
    expect(comparator).toContain("material unknown that can change the finding set");
    expect(historical).toContain("docs/proposals/permit-burden-v1.ts");

    // The metric reads two scalars off a deduplicated finding. One is guarded at ruleset load and
    // one is not, and the spec has to say which is which rather than assume both hold. #239 owns
    // the unguarded half; while it is open the metric is an approval blocker, not a criterion.
    expect(comparator).toContain("rejectMixedDedupeVerificationStatuses()");
    expect(comparator).toContain("Disposition has no such guard");
    expect(comparator).toContain("#239");

    // The invariant, stated once and asserted directly rather than parsed out of prose: for each
    // of the three engine enumerations, the two burden sets COVER it exactly and are DISJOINT.
    // This replaced a guard that read the spec's sentences and was repaired four times, each fix
    // buying one prose shape. Set equality cannot be walked around by rewording anything.
    const burden = await import("../docs/proposals/permit-burden-v1.ts");

    // Coverage and disjointness constrain the UNION only, so they hold under any swap between the
    // two halves: moving `permit` to excluded and `advisory` to counted leaves both assertions
    // green while every organizer's burden count changes. Which side a token sits on is the
    // decision F-103 made, and nothing derives it — so the expectation is written out here, as a
    // second independent statement of it. A one-sided edit to the artifact now fails against this
    // list, and a genuine re-decision has to change the spec, the artifact, and this guard
    // together, which is what a ratified decision changing should cost.
    const partitions = [
      {
        name: "FindingKind",
        // `FindingKind` is `Exclude<RuleKind, "classification">`, which the compiler resolves, so
        // the guard reads the same type the artifact's `satisfies` clauses are written against
        // instead of restating the exclusion here.
        members: unionMembers("FindingKind"),
        included: burden.BURDEN_COUNTED_KINDS,
        excluded: burden.BURDEN_EXCLUDED_KINDS,
        expectedIncluded: [
          "dependency",
          "eligibility",
          "insurance",
          "notification",
          "permit",
          "prohibition",
          "registration",
        ],
        expectedExcluded: ["advisory", "note"],
      },
      {
        name: "Disposition",
        members: unionMembers("Disposition"),
        included: burden.BURDEN_COUNTED_DISPOSITIONS,
        excluded: burden.BURDEN_EXCLUDED_DISPOSITIONS,
        expectedIncluded: ["may_be_required", "prohibited_or_ineligible", "required"],
        expectedExcluded: ["advisory", "no_new_requirement"],
      },
      {
        name: "VerificationStatus",
        members: unionMembers("VerificationStatus"),
        included: burden.BURDEN_DEFINITE_STATUSES,
        excluded: burden.BURDEN_UNRESOLVED_STATUSES,
        expectedIncluded: ["SOURCE_CONFIRMED", "VERIFIED"],
        expectedExcluded: ["COVERAGE_GAP", "OFFICIAL_CONFLICT", "RESEARCH_REQUIRED"],
      },
    ];

    for (const partition of partitions) {
      const { name, members, included, excluded } = partition;
      expect(members.length, `${name} has members`).toBeGreaterThan(0);
      const declared = [...included, ...excluded];

      // No duplicate: a token in both halves would make the counting semantics contradictory.
      expect(new Set(declared).size, `${name} sets are disjoint`).toBe(declared.length);
      // Exact coverage, both directions at once: no engine member unaccounted for, and no
      // declared member the engine does not have.
      expect([...declared].sort(), `${name} is covered exactly`).toEqual([...members].sort());
      // Each half by itself, so a token cannot move across the partition unnoticed.
      expect([...included].sort(), `${name}: the counted half is unchanged`).toEqual(
        partition.expectedIncluded,
      );
      expect([...excluded].sort(), `${name}: the excluded half is unchanged`).toEqual(
        partition.expectedExcluded,
      );
    }
  });

  it("#213: F-107 saves follow the immutable Event Revision contract, legacy bound included", () => {
    const contract = read("docs/EVENT-REVISION-CONTRACT.md");
    const saveResume = read("specs/F-107-save-resume.md");

    expect(contract).toContain(
      "F-107 may save `incomplete` revisions but does not add a separate submission transition",
    );
    expect(saveResume).toContain("Every changed save appends exactly one immutable revision");
    expect(saveResume).toContain("F-107 does not add a separate submission transition");

    // Added at ratification. The draft resolved the submission-transition question and said
    // nothing about the constraint that most limits the feature, so an implementation could have
    // written the NULLs and defaults the contract forbids and contradicted nothing on the page.
    const criteria = section(saveResume, "## Acceptance Criteria");
    expect(criteria, "F-107 states acceptance criteria").not.toBeNull();
    expect(criteria).toContain("F107-AC-08");
    expect(criteria).toContain("rejected without appending a revision or changing any projection");
    expect(criteria).toContain(
      "never retains the previous value, substitutes a default, or writes",
    );
  });

  // Added 2026-08-03 with #209's resolution. The register renumbered twice while this decision was
  // open: the admission-limit row was T-5, then T-6, and T-5 is now the unrelated open
  // ruleset-regeneration race. A comment carrying the row number therefore sends a maintainer to
  // whichever question happens to sit at that number today. The issue number does not move, so the
  // implementation cites that and nothing else. Expressed as "no register row here" rather than as
  // a list of the two wordings that have already been wrong, because the third would be a third
  // wording.
  it("#209: the admission-limit implementation cites the issue, not a register row", () => {
    const sources = [
      "apps/api/src/rsvps.ts",
      "apps/api/src/rsvps.test.ts",
      "apps/web/app/events/[id]/guests/guest-list.test.tsx",
    ];

    for (const path of sources) {
      const source = read(path);
      expect(source, `${path} cites the admission-limit conflict`).toContain("SPEC-CONFLICT #209");
      expect(source.match(/\bT-\d+\b/g), `${path} names no register row`).toBeNull();
    }
  });
});

/**
 * Added 2026-08-04 with the PR #225 review round. Each of these criteria was absent once, and the
 * spec read as complete without it: nothing on the page contradicted an implementation that
 * delivered a stale alert, skipped the backfill, left half a comparison persisted, or lost a
 * confirmed correction. So each is asserted against the spec's parsed Acceptance Criteria section
 * rather than the whole file, which is the difference between "the spec accepts this" and "the
 * spec mentions this somewhere".
 */
describe("PR #225 review round, 2026-08-04", () => {
  const criteriaOf = (path) => {
    const criteria = section(read(path), "## Acceptance Criteria");
    expect(criteria, `${path} states acceptance criteria`).not.toBeNull();
    return criteria;
  };

  it("F-107 accepts the delivery fence and the backfill/writer-authority cutover", () => {
    const criteria = criteriaOf("specs/F-107-save-resume.md");

    // §2.5: the pointer advance and the provider handoff share one fence. The recheck-then-send
    // shape is the one an implementation reaches for, so its rejection is asserted directly.
    expect(criteria).toContain("F107-AC-09");
    expect(criteria).toContain("linearizable through one shared eligibility fence");
    expect(criteria).toContain("A recheck followed by an unfenced provider call does not satisfy");

    // §2.6: the backfill and the boundary are one criterion, and both failure paths abort.
    expect(criteria).toContain("F107-AC-10");
    expect(criteria).toContain("aborts the transaction rather than partially mutating");
    expect(criteria).toContain("If F-107 cannot prove the boundary, the migration aborts");

    // §2.7's part of it: three provenance states, not one. Collapsing them passes §2.6's letter.
    for (const sentinel of ["legacy_unrecorded", "not_applicable"]) {
      expect(criteria, `F-107 keeps the ${sentinel} provenance state distinct`).toContain(sentinel);
    }
  });

  it("F-103 accepts no half-persisted comparison and no comparison in plan history", () => {
    const criteria = criteriaOf("specs/F-103-scope-comparator.md");
    expect(criteria).toContain("F103-AC-06");
    expect(criteria).toContain("persists both plans or neither");
    // The half-persist rule was never the whole defect. A comparison that succeeded and then
    // committed both sides as F-201 generations moved the organizer's latest plan to a
    // configuration they did not choose, which is what AC-06 originally allowed in terms.
    expect(criteria).toContain("never F-201 generations");
    expect(criteria).toContain("PlanService.latest()");
    expect(criteria).toContain("F103-AC-07");
    expect(criteria).toContain("only when the organizer explicitly selects it");
  });

  it("F-405 accepts idempotent source creation and serialized source edits", () => {
    const criteria = criteriaOf("specs/F-405-day-of-runbook.md");
    expect(criteria).toContain("F405-AC-07");
    expect(criteria).toContain("stable client-supplied request identity");
    // The wrong reading of idempotency is content uniqueness, which would reject a real second
    // load-in task that happens to read the same. The criterion excludes it in terms.
    expect(criteria).toContain("never content uniqueness");
    expect(criteria).toContain("F405-AC-08");
    expect(criteria).toContain("never applied as a last-write-wins overwrite");
  });

  // The compatibility window kept the guest list RENDERING in either deployment order and was
  // described as making the window order-independent, which it never did: api-first, the legacy
  // page shows `headcount` as a limit the api does not enforce. #236 owns the defect; the claim
  // is the part that had to go, and it must not come back into either artifact that carried it.
  it("nothing claims the capacity compatibility window is order-independent", () => {
    for (const path of ["apps/api/src/rsvps.ts", "specs/F-302-rsvp-guest-list.md"]) {
      const source = read(path);
      expect(source, `${path} points at the deferred defect`).toContain("#236");
      expect(source, `${path} does not claim both deployment orders are safe`).not.toMatch(
        /neither deployment order breaks/i,
      );
    }
  });
});

/**
 * Added 2026-08-04 with the F-101 restoration. Three artifacts say whether AC 8's one-click
 * regeneration is met on the event overview: the spec decides it, the register row that tracked the
 * gap reports it, and the manifest is what AGENTS.md:11 sends a contributor to FIRST. Two agreeing
 * and one lagging is what happened: the manifest went on saying the restoration was outstanding
 * after it landed, so the agreement is asserted rather than assumed.
 *
 * Each artifact has to name the surface that restores it. That is the one fact a lagging record
 * cannot carry: a paragraph written before the change had no file to name. Asserting the naming
 * rather than a phrasing leaves every artifact free to say it in its own words, and leaves no way
 * to satisfy the check without having read what shipped.
 *
 * `BASELINE.md` records decisions newest first, so the FIRST paragraph mentioning the criterion is
 * the record a top-down reader believes. Superseded paragraphs below it stay as written.
 */
describe("F-101 AC 8 restored on the overview, 2026-08-04", () => {
  const restoringSurface = "apps/web/app/events/[id]/plan-stale-notice.tsx";

  /** The newest of the manifest's dated records that speaks to this criterion. */
  function currentBaselineRecord() {
    const records = read("docs/BASELINE.md")
      .split(/\n{2,}/)
      .filter((p) => p.startsWith("**") && p.includes("F-101") && p.includes("regeneration"));
    expect(records.length, "docs/BASELINE.md records F-101's regeneration at all").toBeGreaterThan(
      0,
    );
    return records[0];
  }

  it("the manifest's current record names the surface the criterion is met on", () => {
    expect(currentBaselineRecord()).toContain(restoringSurface);
  });

  it("the spec's criterion and the register row name the same surface", () => {
    const criteria = section(read("specs/F-101-event-intake.md"), "## Acceptance Criteria");
    expect(criteria, "specs/F-101-event-intake.md states acceptance criteria").not.toBeNull();
    expect(criteria).toContain(restoringSurface);

    const t5 = read("docs/OPEN-QUESTIONS.md")
      .split("\n")
      .find((line) => line.startsWith("| T-5 "));
    expect(t5, "docs/OPEN-QUESTIONS.md carries a T-5 row").toBeDefined();
    expect(t5).toContain(restoringSurface);
  });
});

/**
 * Added 2026-08-05 with the T-8 closure (SPEC-CONFLICT #225). The defect was a reading, not a
 * wording: a row that records a CONSEQUENCE sat in a table whose every other row records a build
 * ORDER, so reading the graph literally put F-601 before F-109 while both proposals require the
 * reverse. The resolution labels the row rather than sequencing the work, so what has to hold is
 * structural and is asserted that way: inside the dependency-graph section, the row naming F-601
 * and F-109 must not be readable as one of that table's ordered rows, and it must say which of the
 * two things it is. Asserting the absence of the ordering arrow plus the presence of a
 * self-description leaves the wording free and leaves no way to satisfy the check by restoring the
 * ordered form.
 */
describe("T-8 F-601/F-109 dependency-graph row, resolved 2026-08-05", () => {
  /** The dependency-graph bullet that names both features. */
  function row() {
    const graph = section(read("docs/DESIGN.md"), "## Dependency Graph (build-order constraints)");
    expect(graph, "docs/DESIGN.md carries the dependency graph").not.toBeNull();
    const rows = graph
      .split("\n")
      .filter((line) => line.startsWith("- ") && line.includes("F-601") && line.includes("F-109"));
    expect(rows.length, "exactly one graph row relates F-601 and F-109").toBe(1);
    return rows[0];
  }

  it("the row carries no build-order arrow", () => {
    expect(row()).not.toContain("→");
  });

  it("the row says it is a consequence note rather than a build-order constraint", () => {
    expect(row()).toMatch(/consequence note, not a build-order constraint/i);
  });

  it("the register records T-8 resolved and names the ADR that carries it", () => {
    const t8 = read("docs/OPEN-QUESTIONS.md")
      .split("\n")
      .find((line) => line.startsWith("| T-8 "));
    expect(t8, "docs/OPEN-QUESTIONS.md carries a T-8 row").toBeDefined();
    expect(t8).toContain("RESOLVED 2026-08-05");
    expect(t8).toContain("AD-17");
    expect(read("docs/ARCHITECTURE-FUTURE.md")).toContain("| AD-17 |");
  });
});

/**
 * Added 2026-08-05 with the DOHMH-trigger removal (issue #235). The claim was that F-101
 * `headcount` drives "the DOHMH thresholds". No published DOHMH rule reads `headcount`: all three
 * key on `food_present` and `event_open_to_public`, and `DOHMH-ORGANIZER-NOTIFY-001` alone also
 * reads `food_vendor_count`. So the clause invented a regulatory trigger, which AGENTS.md's first
 * non-negotiable forbids outright.
 *
 * THREE, and the miscount is worth writing down because it is the same failure in miniature.
 * `CONF-NO-FOOD-001` is the fourth rule commonly counted here, and it is not a DOHMH rule: its
 * `kind` is `classification` and it publishes NO `agency` at all. Calling it one attributes an
 * agency the ruleset does not publish, which is what the first non-negotiable forbids. Of the three
 * that do carry DOHMH, `DOHMH-VENDOR-PERMIT-001` and `DOHMH-ORGANIZER-NOTIFY-001` publish
 * `output.agency` "DOHMH"; `DOHMH-EXEMPTION-001` is an `advisory` and publishes no `agency` either,
 * so the filter below matches on the rule id OR the agency rather than on the agency alone.
 *
 * It needs a guard because the recurrence is measured, not hypothetical: PR #245 was authored
 * after the audit that removed the clause and put it back in TWO new places the same morning, one
 * of which the rebase carried. Governance §5 step 7 asks for a regression check and for a
 * statement of what it covers, and this comment is that statement.
 *
 * WHAT THIS GUARD DOES AND DOES NOT DELIVER. It is asserted in two ways, and they are not equally
 * strong. Read the second one as a partial check, because that is what it is.
 *
 * 1. STRUCTURALLY, against every published ruleset in the tree, and this half holds absolutely.
 *    The fact the prose got wrong is a property of the artifact, which intake fields a DOHMH
 *    rule's trigger reads, so it is read off the parsed trigger rather than restated here. A
 *    ruleset has no wording to vary: if a future one ever does publish a DOHMH rule keyed on
 *    headcount, this assertion fails first and says so.
 * 2. IN PROSE, as a LEXICAL CO-OCCURRENCE SCAN, with the SAME parsed trigger deciding whether a
 *    flagged pairing is an offence. A block that names the city health agency and names an
 *    attendee count is putting the two together; whether that is a false claim is not a question
 *    about the sentence's verb, it is a question about the ruleset, so the ruleset answers it.
 *
 *    But WHAT GETS FLAGGED is decided along TWO dimensions, and a reader who only knows about the
 *    first will over-read a green suite.
 *
 *    LEXICALLY, by a set of regular expressions over English, and no set of them recognises every
 *    way of saying this. The claim can be made in words none of them match.
 *
 *    STRUCTURALLY, by where the words sit. The unit is the BLOCK, a paragraph or a list item or a
 *    table row READ AS ONE LINE OF PROSE (`normalizeForMatching`: the line breaks, the comment
 *    leaders that follow them and the emphasis and inline-code markers are normalized away before
 *    matching, and never for a digest), plus one boundary: two ADJACENT blocks are also scanned as
 *    a pair. So the claim is
 *    caught when its two halves share a block or sit in neighbouring ones, and a phrasing this
 *    scan matches lexically still goes past when its halves are separated by a third block. Two
 *    further structural limits, both stated with their measured reason in
 *    `scripts/spec-conflict-scan.mjs`: across a boundary, the ordinary-English half of the count
 *    vocabulary ("20 attendees") pairs only between two PARAGRAPHS, while the outright count
 *    phrases ("headcount", "attendance") pair between blocks of any kind; and the distance bound
 *    applies in `.ts` and `.tsx` files, in a block and across a boundary, but not in `.md` and not
 *    in the files `UNBOUNDED_RECORD_FILES` names.
 *
 *    Both dimensions were widened by the fourth PR #247 review round, by the fifth, which found
 *    the fourth round's claim to have been wrong on both counts, and by the sixth, which found the
 *    fifth's lexical fix to have been one-sided and its structural one to have left every pinned
 *    block's two boundaries unscanned.
 *
 *    The fourth round reported no fourth LEXICAL gap inside the declared vocabulary. There was
 *    one. `RSVPs` and `patrons` were declared count nouns in `COUNTED_PEOPLE` and appeared in
 *    neither phrasing of `ATTENDEE_COUNT`, and `COUNTED_PEOPLE` requires a numeral that "the RSVP
 *    count" and "the number of RSVPs" do not carry, so all three of these passed: "the RSVP count
 *    is a regulatory input driving the DOHMH thresholds", which is the pinned register row's own
 *    sentence with one noun swapped; "DOHMH keys its temporary food-service permit on the number
 *    of RSVPs recorded at intake"; and "DOHMH requires a permit once the patron count reaches
 *    seventy-five". The FIFTH ROUND'S OWN FIX WAS ONE-SIDED, which the sixth round found: it added
 *    the two nouns to `ATTENDEE_COUNT` and did not check the other direction, so `persons` and
 *    `heads` stayed declared here and missing from `COUNTED_PEOPLE`, and "DOHMH requires a
 *    temporary food-service permit for indoor assembly occupancies used by 75 persons or more"
 *    passed while the same sentence ending "75 or more guests" failed. That is the Building Code's
 *    own wording, quoted in the published ruleset. Nor could the anti-drift grid have caught it:
 *    its fourteen cells carried no numeral, so `COUNTED_PEOPLE` never fired in any of them. The
 *    grid is 7 nouns by THREE phrasings now, and the two noun lists are asserted EQUAL AS SETS,
 *    derived from the two source strings rather than restated, in
 *    `spec-conflict-resolutions.fixtures.test.mjs`.
 *
 *    The fourth round reported three STRUCTURAL gaps closed: a claim split across two register
 *    rows, across two bullets, and across two sentences of one paragraph. The third was closed.
 *    The first two were not. The cross-boundary pass was bounded by `PROXIMITY` measured over the
 *    concatenated pair, and this repository's rows and paragraphs are thousands of characters
 *    wide, so that pass had never fired on any scanned root. What certified it was a fixture built
 *    from two hand-written register rows about 110 characters long, in a file whose every other
 *    fixture was representative. The bound is dropped in prose now and the fixtures are rebuilt
 *    from the real rows and paragraphs, at their real widths.
 *
 *    So do not read a green suite as "the contradiction cannot return"; read it as "the
 *    contradiction has not returned in a phrasing this scan matches, laid out where it looks".
 *    Measured phrasings it does NOT catch, as of this round:
 *
 *      - "The F-101 intake field drives the DOHMH thresholds." No count word appears, because the
 *        repository's own correction records adopt exactly that circumlocution (see the cost note
 *        below). The house style for writing around this guard is documented inside it, and
 *        closing this hole would flag the correction records that use it.
 *      - "DOHMH requires a permit above 75." A bare threshold numeral with no count noun. Matching
 *        bare numerals near an agency mention was measured against this tree and flagged 52
 *        blocks, nearly all of them true deadline and rule-id facts ("notify DOHMH 30 days
 *        before"), so it is deliberately not done.
 *      - "DOH requires a permit at 75 or more guests." The bare acronym. It names New York STATE's
 *        department at least as readily as the city's in this domain, and the state department
 *        publishes a real attendance threshold that this guard has already false-flagged once, so
 *        the acronym is declared a miss rather than matched. The spelled-out name IS matched with
 *        an ampersand and without the "Department of" prefix, added in the sixth round at a
 *        measured cost of zero blocks on this tree.
 *      - "DOHMH keys the permit on the guest-count threshold." The hyphenated compound. Matching it
 *        costs a false positive on the correction record itself, which writes "the attendee-count
 *        intake field" while DENYING the attribution, so it is declared rather than closed. The
 *        reason and the measurement are at `ATTENDEE_COUNT_SOURCE`.
 *      - A count phrase split by a line break inside a `*`-leader DOC COMMENT. That one is
 *        structural rather than lexical: `blocksOf` reads a ` * ` leader as a list bullet, so each
 *        line is its own block and there is no wrapped line to rejoin. The `//` form is caught, and
 *        that is the form the correction record names in `apps/api/src/rsvps.ts`.
 *      - Any paraphrase that names neither the agency forms below nor a count phrase below.
 *
 *    THIS LIST IS NO LONGER THE MECHANISM, which is the seventh PR #247 round's item 2. It reads
 *    to a human; what a change has to survive is a corpus. Every anti-drift device in this guard
 *    used to measure one DECLARATION against another (a source string against a source string, a
 *    grid cell against a grid cell), so a phrasing the guard CLAIMS TO COVER could stop being
 *    caught without failing anything, and one had: the count vocabulary is joined by literal single
 *    spaces and this tree's prose is hard-wrapped, so a line break inside a count phrase walked
 *    past everything. `spec-conflict-resolutions.fixtures.test.mjs` generates the declared
 *    vocabulary over the artifacts' real formatting now, the seven nouns by the three phrasings by
 *    wrapped-at-this-tree's-`printWidth`, inline code, bold and hyphenated, and asserts that the
 *    cases which miss are EXACTLY the hyphenated compound named above. A fourth phrasing inside the
 *    vocabulary quietly stopping being caught fails there, and this list only has to be kept honest
 *    about what sits outside the vocabulary.
 *
 *    Semantic or model-based detection would be a different project and is out of scope here.
 *
 *    The ruleset half of the pairing, by contrast, has no such gap: while no published DOHMH
 *    rule's trigger reads the attendee-count intake field, a pairing this scan does flag is
 *    unsupported however the sentence is worded. If a ruleset ever does publish that trigger the
 *    pairing becomes supported and the offender scan stops flagging it. That is NOT a change this
 *    file sits out: the sibling assertion below, "no published ruleset keys a DOHMH rule on an
 *    attendee count", hard-fails on exactly that commit, so publishing the trigger means amending
 *    that assertion in the same commit as a deliberate act. An earlier version of this comment
 *    promised the opposite, that the scan would stop flagging "in the same commit and without an
 *    edit here", which described a path the sibling assertion makes unreachable. The
 *    short-circuit's real job is narrower and still worth having: it keeps the offender scan from
 *    reporting prose that has become true. That short-circuit is scoped to the OFFENDER scan
 *    alone. The pin presence check reads the raw files, so a ruleset change can never report the
 *    four protected approvals as deleted.
 *
 *    An earlier version of this check required a THIRD match, an attribution verb, against a list
 *    of nine: drives, triggers, keys on, gates, threshold, feeds, turns on, depends on, governs.
 *    That was the denylist shape the header of this file says was removed from this repository, and
 *    it leaked exactly as that comment predicts. Measured against the guard as it stood, "the F-101
 *    headcount field drives the DOHMH thresholds" was caught, and "determines which DOHMH
 *    requirements apply", "DOHMH requires a temporary food-service permit once headcount reaches
 *    75", "the guest count decides the Health Department's permit requirement" and "based on
 *    headcount, DOHMH requires organizer notification" all passed. Deleting the verb test is what
 *    closed that, not lengthening it.
 *
 *    The cost is stated rather than hidden: a block that DENIES the attribution is flagged too,
 *    because the guard reads co-occurrence and not stance. The repository's correction records are
 *    written without the pairing for that reason, naming the intake field as "the F-101 intake
 *    field" where they discuss DOHMH, and a future correction has to do the same or be pinned.
 *    Against the tree as it stands the co-occurrence flags TEN blocks: the four pinned historical
 *    records, and the six adjacent pairs `BENIGN_ADJACENT_PAIRS` names, which are the price of
 *    running the cross-boundary pass unbounded in prose. Each of those six is two unrelated true
 *    statements sharing a boundary, and one of them is the correction record itself. Six is what
 *    THIS TREE has as of this commit and not what the design costs: any true, agency-free new block
 *    carrying a count word that lands beside one of the 81 count-free blocks that name the agency
 *    is a seventh, and its author had nothing to do with either fact. That is stated at that list
 *    and in the offender failure message rather than left for a contributor to discover.
 *
 *    The block, not the sentence, is the unit: both of the sites this defect has actually taken (a
 *    dated BASELINE paragraph and a register table row) carried the count and the agency in
 *    different sentences of one block, so a sentence-level check would have watched both go past.
 *    In `.md` that is now true of the whole vocabulary. It was not until the fourth PR #247 round:
 *    the `guests / attendees / people / RSVPs / patrons` half was distance-bounded everywhere, so
 *    for that half the check WAS effectively sentence-level and the two-sentence shape passed.
 *
 *    Every list item and table row is its own block, and adjacent blocks are scanned across their
 *    boundary. What that buys, stated at the width of the real artifacts rather than in general:
 *
 *      - IN PROSE, the claim cannot be split between two register rows, two bullets, a paragraph
 *        and the bullet under it, or two paragraphs separated by one blank line, at any distance,
 *        as long as one half is an outright count phrase. Split with the ordinary-English half
 *        ("20 attendees"), it is caught between two PARAGRAPHS and not between two rows or bullets.
 *      - IN `.ts` AND `.tsx`, all of that is still bounded by `PROXIMITY`, so a claim split across
 *        a boundary in code is caught only within 120 characters. `UNBOUNDED_RECORD_FILES` is the
 *        exception, and it is two files.
 *
 *    Two earlier versions of this paragraph claimed the first bullet without the qualification and
 *    without the second, and neither was true when written. The boundary pass required both blocks
 *    to be PARAGRAPHS until the fourth PR #247 round, which made "every list item and table row is
 *    its own block" a description of where the claim could hide rather than of why it could not.
 *    The fourth round dropped that filter for the outright count phrases and bounded the pass by
 *    `PROXIMITY` instead, which on this tree's real widths meant the pass never fired at all: the
 *    fifth round measured 41 single-block flags and zero cross-boundary pairs over every scanned
 *    root. So the sentence "the claim cannot be split between two register rows" was false for
 *    this repository's own text on the commit that wrote it.
 *
 * The state health department is a different agency and is excluded: `docs/VERIFICATION-SOURCES.md`
 * quotes SDOH's own attendance threshold, which is a real published fact about SDOH.
 */
describe("no DOHMH rule is attributed to headcount, removed 2026-08-05 (#235)", () => {
  const SCANNED_ROOTS = ["docs", "specs", "apps", "packages", "rules", "scripts"];
  const SKIPPED_DIRS = new Set(["node_modules", "dist", "coverage", ".next"]);

  /**
   * The guard's own three source files. They are skipped EXPLICITLY, and they are the only skipped
   * files.
   *
   * `scripts/` was outside `SCANNED_ROOTS` until 2026-08-05, and so were the repository-root
   * markdown files, so `AGENTS.md`, the document carrying the non-negotiable this guard enforces,
   * could take the banned clause with the whole suite green. Adding them puts this file inside its
   * own scan, where it necessarily fails: it QUOTES the clause in the comment above, and it quotes
   * the paraphrases the verb list used to miss, so several of its blocks pair the agency with the
   * count. That is the guard's definition, not a claim the guard makes.
   *
   * Rewording the comment to stop quoting the clause was the alternative and is worse: it would
   * leave the exclusion implicit, so the file would pass by whatever wording it happened to carry
   * and silently start failing on the next honest edit to the comment. Worse still, the regex
   * constants cannot be reworded at all without weakening the detection. Naming the exclusion once,
   * here, is the version a reader can see and audit.
   *
   * The list grew from one file to three when the mechanism moved to `spec-conflict-scan.mjs` so
   * that a fixture suite could drive it (`vitest.config.ts` lines 27-29). Those two files carry the
   * regex constants and the fixture strings, so they pair the agency with a count for the same
   * reason this one does. THE COST IS REAL AND IS STATED RATHER THAN HIDDEN: a live claim written
   * into any of the three would not be flagged by this scan. Nothing else in the tree is exempt,
   * and a fourth entry here should be read the way a fifth pin is: a governance action, not
   * a way to quiet the guard.
   */
  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  const GUARD_SOURCES = new Set(
    [
      "spec-conflict-scan.mjs",
      "spec-conflict-resolutions.test.mjs",
      "spec-conflict-resolutions.fixtures.test.mjs",
    ].map((name) => resolve(scriptsDir, name)),
  );

  /**
   * Every scanned file: the roots walked recursively, plus the repository root's OWN files, which
   * are read non-recursively so the walk never descends into `.git` or `node_modules`. The root is
   * read as a directory rather than as a list of filenames on purpose. An enumerated list leaves
   * the next root document added to this repository outside the guard, which is the exact hole
   * being closed.
   */
  function filesUnder(roots, extensions) {
    const found = [];
    const matches = (name) => extensions.some((extension) => name.endsWith(extension));
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (matches(entry.name)) found.push(path);
      }
    };
    for (const root of roots) walk(resolve(repoRoot, root));
    for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() && matches(entry.name)) found.push(resolve(repoRoot, entry.name));
    }
    return found.filter((path) => !GUARD_SOURCES.has(path));
  }

  /** Every `field` a trigger names, at any nesting depth of `all` / `any` / `not`. */
  function triggerFields(node, into = new Set()) {
    if (Array.isArray(node)) for (const child of node) triggerFields(child, into);
    else if (node && typeof node === "object") {
      if (typeof node.field === "string") into.add(node.field);
      for (const value of Object.values(node)) triggerFields(value, into);
    }
    return into;
  }

  /** The city health agency's rules, by id OR published agency: two of the three publish neither. */
  const CITY_HEALTH_RULE = /DOHMH/i;

  /** The published intake field the prose calls an attendee count. */
  const ATTENDEE_COUNT_FIELD = "headcount";

  /**
   * Every PUBLISHED ruleset in the tree, parsed.
   *
   * `rules/*.json` and nothing deeper. "Any `.json` under the scanned roots that carries a `rules`
   * array" was the earlier definition and it was wrong in both directions in this tree, which
   * holds three such files: the published `rules/nyc-rules.v2.11.json`, the PROPOSED 59-rule
   * `rules/proposals/nyc-rules.v2-full-draft.json`, and the superseded
   * `packages/engine/src/__fixtures__/nyc-rules.v2.3.json`. AGENTS.md's authority order puts a
   * published rule above an approved fixture and `docs/BASELINE.md` says to stop on PROPOSED
   * inputs, so neither of the other two answers a question about what is published. Editing the
   * DRAFT used to fail the assertion below with a message saying "no PUBLISHED ruleset", and in
   * the same run it short-circuited the offender scan to nothing, so live prose carrying the claim
   * went unreported.
   *
   * The same rule the api and the engine already use: `apps/api/src/ruleset.ts` and
   * `packages/engine/src/__fixtures__/published-ruleset.ts` both read `rules/` non-recursively,
   * with the comment "`rules/proposals/` is drafts and excluded".
   */
  const PUBLISHED_RULESET_PATH = /^rules\/[^/]+\.json$/;
  function publishedRulesets() {
    const rulesets = filesUnder(SCANNED_ROOTS, [".json"])
      .map((path) => [path.replace(`${repoRoot}/`, ""), path])
      .filter(([relative]) => PUBLISHED_RULESET_PATH.test(relative))
      .map(([relative, path]) => [relative, JSON.parse(readFileSync(path, "utf8"))])
      .filter(([, artifact]) => Array.isArray(artifact.rules));
    expect(rulesets.length, "the tree carries at least one published ruleset").toBeGreaterThan(0);
    return rulesets;
  }

  /**
   * Whether any published ruleset keys a city health rule on the attendee-count intake field. This
   * IS the attribution test the prose scan below uses: the prose claim is true exactly when this is
   * true, so it is answered from the parsed trigger rather than from how a sentence is phrased.
   */
  function aHealthRuleReadsTheAttendeeCount() {
    return publishedRulesets().some(([, artifact]) =>
      artifact.rules
        .filter(
          (rule) =>
            CITY_HEALTH_RULE.test(rule.id ?? "") ||
            CITY_HEALTH_RULE.test(rule.output?.agency ?? ""),
        )
        .some((rule) => triggerFields(rule.trigger).has(ATTENDEE_COUNT_FIELD)),
    );
  }

  it("no published ruleset keys a DOHMH rule on an attendee count", () => {
    for (const [path, artifact] of publishedRulesets()) {
      const health = artifact.rules.filter(
        (rule) =>
          CITY_HEALTH_RULE.test(rule.id ?? "") || CITY_HEALTH_RULE.test(rule.output?.agency ?? ""),
      );
      for (const rule of health) {
        expect(
          [...triggerFields(rule.trigger)],
          `${path}: ${rule.id} reads no attendee count`,
        ).not.toContain(ATTENDEE_COUNT_FIELD);
      }
    }
  });

  /** Every block of one tracked file, flagged or not. */
  const blocksOfFile = (file) => blocksOf(read(file)).map((text) => ({ relative: file, text }));

  /**
   * Every block in the tree that pairs the city health agency with an attendee count, within one
   * block or ACROSS THE BOUNDARY between two adjacent blocks.
   *
   * The pairing itself lives in `scripts/spec-conflict-scan.mjs`, which states what each bound is
   * for and which file kinds carry it. What this function adds is the tree: which files are
   * scanned, and the one condition under which scanning them is pointless.
   */
  function flaggedBlocks() {
    // The ruleset decides whether the pairing is an offence at all. If a published DOHMH rule ever
    // does key on the attendee count, the prose claim becomes true and there is nothing to flag.
    if (aHealthRuleReadsTheAttendeeCount()) return [];

    const flagged = [];
    for (const path of filesUnder(SCANNED_ROOTS, [".md", ".ts", ".tsx", ".mjs", ".js"])) {
      const relative = path.replace(`${repoRoot}/`, "");
      // Two independent questions, answered by two lists since the fifth PR #247 round, and
      // answered in `scanOptionsFor` rather than here since the sixth: both of those answers were
      // one clause of this function, and reverting either left the whole suite green.
      const found = scanFile(readFileSync(path, "utf8"), scanOptionsFor(relative));
      for (const item of found) flagged.push({ relative, ...item });
    }
    return flagged;
  }

  /** What to do about a pin that no longer matches. Written for a reader who has no context. */
  function pinFailure(pin, state) {
    return [
      `${pin.file}: the pinned historical record "${pin.record}" ${state}.`,
      "",
      "This block is PINNED. It is one of four recorded approvals that carry the struck",
      '"DOHMH thresholds" clause, an unsupported regulatory claim corrected by the 2026-08-05',
      "correction record in docs/BASELINE.md. Its wording is protected by",
      "docs/DOCUMENTATION-GOVERNANCE.md §6 line 103: an approval recorded in named capacities",
      "under the rules then in force stays on the record in the words it was given. The clause",
      "is corrected BY A NEW DATED RECORD, never by editing these words.",
      "",
      "If you changed this record's wording, revert it and write a new dated correction record",
      "in docs/BASELINE.md instead. If the change is legitimate and does NOT touch the wording",
      "(a prettier reflow, for example), recompute the digest in the same commit and say in the",
      "commit message what moved and why. Do not delete the pin, and do not add a new one to",
      "make a live claim pass: a fifth pin is a governance action, not a way to silence this.",
    ].join("\n");
  }

  it("every pinned historical record is present exactly once and byte-for-byte unchanged", () => {
    for (const pin of HISTORICAL_RECORDS) {
      // Read off the RAW file, not off the flagged set. Presence is a fact about the record and
      // has nothing to do with whether the prose scan ran: `flaggedBlocks()` returns nothing at
      // all once a published ruleset keys a health rule on the attendee count, and reading
      // presence from it reported four deleted approvals when a ruleset changed and docs did not.
      const byAnchor = blocksOfFile(pin.file).filter((item) => item.text.includes(pin.anchor));
      expect(byAnchor.length, pinFailure(pin, "is missing from the file")).toBeGreaterThan(0);
      // EXACTLY once. A pin says one specific historical record is present unchanged; it does not
      // license a second copy of it. The offender scan below cannot catch that on its own, because
      // it matches a pin by file and digest and a byte-identical duplicate matches both.
      expect(byAnchor.length, pinFailure(pin, "appears more than once in the file")).toBe(1);
      expect(
        pinnedDigest(pin, byAnchor[0].text),
        pinFailure(pin, "no longer matches its pinned digest, so its wording has changed"),
      ).toBe(pin.sha256);
    }
  });

  /** Whether a flagged item matches one of `pins`, by file and by digest. */
  const matches = (pins) => (item) =>
    pins.some((pin) => pin.file === item.relative && pinnedDigest(pin, item.text) === pin.sha256);

  // Each benign pair is asserted to still be flagged. An exemption that has stopped being needed
  // is an unexamined exemption, and this is what stops the list growing into one: if an edit
  // separates the two blocks or removes the co-occurrence, this fails and the entry comes out.
  it("every measured benign adjacent pair is still exactly one flagged pair", () => {
    const flagged = flaggedBlocks();
    // `flaggedBlocks()` returns nothing at all once a published ruleset keys a DOHMH rule on the
    // attendee count, so on that commit all six entries below fail at once, with a message about
    // edits separating blocks that no edit made. `HISTORICAL_RECORDS` reads the raw files to avoid
    // exactly this; the benign list cannot, because what it pins is a SCAN RESULT rather than a
    // record. The failure is still the right one to have (it lands beside the ruleset hard-fail
    // above, which is the real news), so the fix is to say which failure this is rather than to
    // suppress it.
    const scanIsOff = aHealthRuleReadsTheAttendeeCount()
      ? "\nNOTE: a published ruleset now keys a DOHMH rule on the attendee count, so the prose scan" +
        " short-circuits to nothing and EVERY entry in this list fails together. Nothing separated" +
        " these blocks. Read the sibling assertion 'no published ruleset keys a DOHMH rule on an" +
        " attendee count' first; that is the change, and this list follows from it."
      : "";
    for (const pin of BENIGN_ADJACENT_PAIRS) {
      const matched = flagged.filter(
        (item) => item.relative === pin.file && pinnedDigest(pin, item.text) === pin.sha256,
      );
      expect(
        matched.length,
        `${pin.file}: the benign pair "${pin.pair}" no longer matches one flagged pair.\n` +
          `It was exempt because: ${pin.why}\n` +
          "If an edit separated the two blocks or changed either one's wording, read the pair" +
          " again. If it is still two facts rather than one claim, recompute the digest in the" +
          " same commit and say what moved. If it is now a claim, the claim is the thing to" +
          " remove. Do not add an entry here to quiet a live claim." +
          scanIsOff,
      ).toBe(1);
    }
  });

  it("no prose block attributes a city health requirement to an attendee count", () => {
    // Pins are an exception to the scan, not a replacement for it: a flagged block is allowed only
    // when its digest is pinned FOR THAT FILE, so the same historical text pasted anywhere else is
    // still an offender. Everything unpinned is reported exactly as before.
    // A duplicate pasted into the SAME file is caught by the exactly-once assertion above.
    // `BENIGN_ADJACENT_PAIRS` is the second, weaker exception, and it is weaker in what it claims
    // rather than in what it costs: a historical record is protected wording, a benign pair is
    // this round's reading that two adjacent blocks are two facts. Both are pinned by digest.
    const isPinned = matches(HISTORICAL_RECORDS);
    const isBenign = matches(BENIGN_ADJACENT_PAIRS);
    const unexplained = flaggedBlocks().filter((item) => !isPinned(item) && !isBenign(item));
    const offenders = unexplained.map(
      (item) =>
        `${item.relative} (${item.kind}): ${item.text.replace(/\s+/g, " ").trim().slice(0, 200)}`,
    );

    // A NEW ADJACENT PAIR is its own failure, and it gets its own paragraph. The sixth PR #247
    // round's item 4 is why: a legitimate new Parks record inserted next to a block that names the
    // health agency fails this assertion, neither block carries a claim, and the message a
    // contributor got sent them to the pinned historical records, which have nothing to do with
    // their edit. `BENIGN_ADJACENT_PAIRS`'s six entries are the adjacencies THIS TREE has, not a
    // bound on what it can have: any new block carrying a count word that lands beside one of the
    // 81 count-free blocks naming the agency is a seventh.
    const newPair = unexplained.some((item) => item.kind === "pair");

    expect(
      offenders,
      "no DOHMH rule reads headcount, so nothing may say one does. The four historical records" +
        " that carry the struck clause are pinned above and corrected by the 2026-08-05 record in" +
        " docs/BASELINE.md; these are not those:\n" +
        offenders.join("\n") +
        (newPair
          ? "\n\nAn entry marked (pair) is TWO ADJACENT BLOCKS, and neither one need carry a" +
            " claim: this scan reads co-occurrence across a boundary, so one block naming the" +
            " agency beside another carrying a count word is enough. If you added or moved a" +
            " block, the first thing to check is whether your block and its NEIGHBOUR are two" +
            " unrelated facts. If they are, the remedy is to separate them, or to add an entry to" +
            " BENIGN_ADJACENT_PAIRS in scripts/spec-conflict-scan.mjs saying why, with the pair's" +
            " digest. That entry is an ordinary cost of this pass, not a governance action; a" +
            " fifth HISTORICAL_RECORDS pin is the one that is."
          : ""),
    ).toEqual([]);
  });

  // The opt-out is honoured in code and nowhere else, and that is asserted rather than left to the
  // scan's own reading of a file extension: a marker written into a document would be inert, so the
  // author would believe they had opted out and the block would be reported as a live claim.
  // Reported here instead, naming the file, rather than as a confusing offender entry.
  //
  // "Code" was `BOUNDED_EXTENSIONS` until the fifth PR #247 round, which is why a new guard fixture
  // under `scripts/*.mjs` had no remedy: the marker was inert there and this assertion told its
  // author so, while the offender scan reported the fixture as a live claim.
  it("the scan's opt-out marker appears only where it is honoured", () => {
    const marked = filesUnder(SCANNED_ROOTS, [".md", ".ts", ".tsx", ".mjs", ".js"])
      .filter((path) => readFileSync(path, "utf8").includes(OPT_OUT_MARKER))
      .map((path) => path.replace(`${repoRoot}/`, ""))
      .filter((relative) => !OPT_OUT_EXTENSIONS.some((extension) => relative.endsWith(extension)));

    expect(
      marked,
      `${OPT_OUT_MARKER} is honoured in ${OPT_OUT_EXTENSIONS.join(", ")} files only. Prose` +
        " cannot opt out of this scan: write around the pairing, or record the wording as a pin.",
    ).toEqual([]);
  });
});
