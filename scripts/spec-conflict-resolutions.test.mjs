import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");

function section(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start < 0) return null;
  const after = markdown.slice(start + heading.length);
  const end = after.search(/\n#{2,3} /);
  return end < 0 ? after : after.slice(0, end);
}

const engineTypesPath = resolve(repoRoot, "packages/engine/src/types.ts");

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

function unionMembers(alias) {
  const { checker, exports } = engineExports();
  const symbol = exports.get(alias);
  expect(symbol, `${alias} is exported from packages/engine/src/types.ts`).toBeDefined();
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  const constituents = type.isUnion() ? type.types : [type];
  for (const constituent of constituents) {
    expect(
      constituent.isStringLiteral(),
      `${alias} is a union of string literals, not ${checker.typeToString(constituent)}`,
    ).toBe(true);
  }
  return constituents.map((constituent) => constituent.value);
}

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

    const dependencies = section(runbook, "## Dependencies and Baseline");
    expect(dependencies, "F-405 declares its dependencies").not.toBeNull();

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

    expect(comparator).toContain("docs/proposals/permit-burden-v1.ts");
    expect(comparator).toContain("`{ definite, unresolved }`");
    expect(comparator).toContain("Count each final deduplicated finding once");
    expect(comparator).toContain("material unknown that can change the finding set");
    expect(historical).toContain("docs/proposals/permit-burden-v1.ts");

    expect(comparator).toContain("rejectMixedDedupeVerificationStatuses()");
    expect(comparator).toContain("Disposition has no such guard");
    expect(comparator).toContain("#239");

    const burden = await import("../docs/proposals/permit-burden-v1.ts");

    const partitions = [
      {
        name: "FindingKind",
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

      expect(new Set(declared).size, `${name} sets are disjoint`).toBe(declared.length);
      expect([...declared].sort(), `${name} is covered exactly`).toEqual([...members].sort());
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

    const criteria = section(saveResume, "## Acceptance Criteria");
    expect(criteria, "F-107 states acceptance criteria").not.toBeNull();
    expect(criteria).toContain("F107-AC-08");
    expect(criteria).toContain("rejected without appending a revision or changing any projection");
    expect(criteria).toContain(
      "never retains the previous value, substitutes a default, or writes",
    );
  });

  it("#209: the admission-limit implementation cites the issue, not a register row", () => {
    const sources = [
      "apps/api/src/attendance/rsvps.ts",
      "apps/api/src/attendance/rsvps.test.ts",
      "apps/web/app/events/[id]/guests/guest-list.test.tsx",
    ];

    for (const path of sources) {
      const source = read(path);
      expect(source, `${path} cites the admission-limit conflict`).toContain("SPEC-CONFLICT #209");
      expect(source.match(/\bT-\d+\b/g), `${path} names no register row`).toBeNull();
    }
  });
});

describe("PR #225 review round, 2026-08-04", () => {
  const criteriaOf = (path) => {
    const criteria = section(read(path), "## Acceptance Criteria");
    expect(criteria, `${path} states acceptance criteria`).not.toBeNull();
    return criteria;
  };

  it("F-107 accepts the delivery fence and the backfill/writer-authority cutover", () => {
    const criteria = criteriaOf("specs/F-107-save-resume.md");

    expect(criteria).toContain("F107-AC-09");
    expect(criteria).toContain("linearizable through one shared eligibility fence");
    expect(criteria).toContain("A recheck followed by an unfenced provider call does not satisfy");

    expect(criteria).toContain("F107-AC-10");
    expect(criteria).toContain("aborts the transaction rather than partially mutating");
    expect(criteria).toContain("If F-107 cannot prove the boundary, the migration aborts");

    for (const sentinel of ["legacy_unrecorded", "not_applicable"]) {
      expect(criteria, `F-107 keeps the ${sentinel} provenance state distinct`).toContain(sentinel);
    }
  });

  it("F-103 accepts no half-persisted comparison and no comparison in plan history", () => {
    const criteria = criteriaOf("specs/F-103-scope-comparator.md");
    expect(criteria).toContain("F103-AC-06");
    expect(criteria).toContain("persists both plans or neither");
    expect(criteria).toContain("never F-201 generations");
    expect(criteria).toContain("PlanService.latest()");
    expect(criteria).toContain("F103-AC-07");
    expect(criteria).toContain("only when the organizer explicitly selects it");
  });

  it("F-405 accepts idempotent source creation and serialized source edits", () => {
    const criteria = criteriaOf("specs/F-405-day-of-runbook.md");
    expect(criteria).toContain("F405-AC-07");
    expect(criteria).toContain("stable client-supplied request identity");
    expect(criteria).toContain("never content uniqueness");
    expect(criteria).toContain("F405-AC-08");
    expect(criteria).toContain("never applied as a last-write-wins overwrite");
  });

  it("nothing claims the capacity compatibility window is order-independent", () => {
    for (const path of ["apps/api/src/attendance/rsvps.ts", "specs/F-302-rsvp-guest-list.md"]) {
      const source = read(path);
      expect(source, `${path} points at the deferred defect`).toContain("#236");
      expect(source, `${path} does not claim both deployment orders are safe`).not.toMatch(
        /neither deployment order breaks/i,
      );
    }
  });
});

describe("F-101 AC 8 restored on the overview, 2026-08-04", () => {
  const restoringSurface = "apps/web/app/events/[id]/plan-stale-notice.tsx";

  function currentBaselineRecord() {
    const record = read("docs/BASELINE.md")
      .split(/\n{2,}/)
      .find((paragraph) => paragraph.startsWith("**Record 2026-08-04 (F-101 lane, PR #242):**"));
    expect(record, "docs/BASELINE.md keeps the PR #242 restoration record").toBeDefined();
    return record;
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

describe("T-8 F-601/F-109 dependency-graph row, resolved 2026-08-05", () => {
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

describe("SPEC-CONFLICT #268 stale assembly-coverage proposal", () => {
  it("keeps the retired proposal out of the active spec set", () => {
    expect(existsSync(resolve(repoRoot, "specs/host-guest-authorisation-coverage.md"))).toBe(false);
  });

  it("keeps the F-110 replacement fields in the active intake registry", () => {
    const ruleset = JSON.parse(read("rules/nyc-rules.v2.12.json"));
    const fields = ruleset.intake_fields.map(({ field }) => field);

    expect(fields).toContain("venue_paco_covers_exact_event");
    expect(fields).toContain("venue_fdny_pa_permit_current_for_event_space");
    expect(fields).not.toContain("venue_has_assembly_approval");
  });
});
