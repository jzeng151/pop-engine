import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

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
