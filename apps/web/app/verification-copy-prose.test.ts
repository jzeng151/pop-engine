import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Prose guard for SPEC-CONFLICT #145: prose must not describe COVERAGE_GAP as an absent source.
//
// FOUR EVASIONS, AND THE SHAPE OF THEM IS THE ARGUMENT FOR THIS DESIGN. In order: a hyphen, a
// compound noun, six instances at the PRD root that nobody had scanned for, and a line break. Three
// of the four were purely mechanical, and each was closed by normalising one more axis. Round 4 stops
// bolting axes on: the unit of matching is now the WHOLE ARTIFACT, so anything that only changes how
// the words are laid out cannot help. Hyphens, underscores, runs of spaces and newlines all normalise
// to the same single space before any pattern runs.
//
// The wordings themselves are spelled out only in the fragment-assembled probes at the bottom of this
// file, never in prose here, because this file is inside layer 2's own scope and a literal would make
// the guard fail on itself.
//
// WHAT WHOLE-FILE NORMALISATION BUYS: the mechanical family is closed, four for four. A writer cannot
// evade it by reflowing, hyphenating, or breaking a phrase across a paragraph.
//
// WHAT IT DOES NOT BUY, and this has not changed: it still cannot decide meaning. "The ruleset has
// not identified an authority" says the same wrong thing in words no pattern here matches, and it
// passes. Every layer below is a bound on how this defect has actually travelled, not a semantic
// check, and a reviewer remains the only thing between a novel formulation and an approved artifact.
//
// It also costs something, stated because the cost is real: matching across the whole file means two
// unrelated sentences either side of a paragraph break are now adjacent to the matcher. That was
// measured rather than assumed before this landed, and the probe below pins the sentences that must
// keep passing.
//
// THREE LAYERS, AND EACH ONE'S GUARANTEE IS STATED EXACTLY. None of them decides meaning; no string
// match can. What they do is bound the ways this defect has actually travelled.
//
//   1. SHIPPED PHRASINGS, repo-wide. Guarantee: a copy-paste of either wording that actually shipped
//      fails anywhere in the repo, including out of git history. Nothing weaker, nothing stronger.
//
//   2. THE SOURCE-ABSENCE FAMILY, scoped, normalised. Guarantee: within the artifacts that define
//      what COVERAGE_GAP means, a phrase attributing source absence to it fails REGARDLESS of
//      hyphenation, spacing or filler words, because the text is normalised before matching. That is
//      what defeats the two evasions above. It does NOT catch a genuinely novel formulation: "the
//      ruleset has not identified an authority" would pass, and a reviewer is still the only thing
//      between that sentence and an approved artifact.
//      The scope is deliberate. Repo-wide, this layer produces three false positives that are all
//      legitimate prose: `docs/VERIFICATION-SOURCES.md` discusses sources genuinely not located,
//      `docs/ARCHITECTURE-FUTURE.md` QUOTES the old wrong wording in order to record its correction,
//      and `apps/api/src/ruleset.ts` uses "no source states" as a verb. A guard that forbids the repo
//      from documenting its own fix is the wrong guard, so the scope is the files that define the
//      status's meaning plus the app that renders it.
//
//   3. THE REQUIRED FORMULATION IS PRESENT, per artifact. Guarantee: DELETION of the correct wording
//      fails. That is all it is, and the limit is not hypothetical: when this rebuild started, all
//      four artifacts already contained the formulation while six clauses inside them contradicted
//      it, so a presence check ALONE would have passed on the broken tree. It is here because removal
//      and contradiction are different failure modes and layer 2 cannot see the first.
const SHIPPED_PHRASINGS: ReadonlyArray<{ phrase: string; why: string }> = [
  {
    // The UI copy both render sites carried.
    phrase: ["source", "not", "yet", "established"].join(" "),
    why: "announces a pending source, which is RESEARCH_REQUIRED's meaning, not COVERAGE_GAP's",
  },
  {
    // F-206 AC 2's phrasing, which PRD, DESIGN and F-201 repeated.
    phrase: ["no", "source", "is", "published"].join(" "),
    why: "states the absence of a source as the status's meaning rather than its consequence",
  },
];

// Assembled from fragments, like the phrases above and for the same reason: a literal written out
// here would be matched by layer 2, because this file sits inside that layer's scope.
const ABSENCE = ["established", "published", "located", "available", "identified"].join("|");
const FAMILY: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: new RegExp(`\\bsource (?:is |was )?not (?:yet )?(?:${ABSENCE})\\b`, "i"),
    why: "attributes a not-established source to the status, which is RESEARCH_REQUIRED's meaning",
  },
  {
    pattern: new RegExp(`\\bno source (?:is |was )?(?:${ABSENCE})\\b`, "i"),
    why: "attributes an absent source to the status, which is RESEARCH_REQUIRED's meaning",
  },
];

// The compound-noun form is matched on the RAW line, not the normalised one. Normalising turns its
// hyphen into a space, which would then also match "no source states" used as a verb in unrelated
// code. The hyphen is what makes it one adjectival unit, so requiring it is what keeps this precise.
// Assembled rather than written as a literal, like everything else here. Written out, the pattern
// would be the one occurrence of the compound in the repo, and it would escape its own check only
// because the leading `\b` puts a word character in front of it. That is luck rather than design:
// drop the leading boundary and the guard fails on itself. Assembling removes the accident.
const COMPOUND = {
  pattern: new RegExp(`\\b${["no", "source"].join("-")}\\b`, "i"),
  why: "the compound form of the same claim",
};

// The formulation the published legend uses, in `rules/nyc-rules.v2.11.json`. Tested after
// normalisation so the hyphenated variant in F-206's Outputs bullet also counts.
const REQUIRED = /\bnot (?:covered|modeled|modelled) by this ruleset version\b/i;

// The artifacts whose criteria mandate a COVERAGE_GAP description, plus the app that renders it.
const MEANING_ARTIFACTS = [
  "docs/PRD.md",
  "docs/DESIGN.md",
  "specs/F-201-permit-plan-generator.md",
  "specs/F-206-rules-snapshot-banner.md",
] as const;

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  } catch (error) {
    // git grep exits 1 with no output when there are no matches, which is the passing case.
    const failure = error as { status?: number; stdout?: string };
    if (failure.status === 1 && !failure.stdout) return "";
    throw error;
  }
}

// The file list comes from git, not a filesystem walk: it respects .gitignore for free, so
// node_modules, build output and the coverage report cannot produce phantom hits, and it only ever
// sees files that are actually tracked.
function trackedTextFiles(): string[] {
  return git(["ls-files"])
    .split("\n")
    .filter(Boolean)
    .filter((file) => {
      // Skip anything with a NUL byte, which is what `git grep -I` did for us before. Reading a
      // binary as UTF-8 would otherwise produce garbage that could match anything.
      try {
        return !readTracked(file).includes("\0");
      } catch {
        return false;
      }
    });
}

function scopedFiles(): string[] {
  const web = git(["ls-files", "apps/web"]).split("\n").filter(Boolean);
  return [...MEANING_ARTIFACTS, ...web];
}

// The working-tree copy, not `git show HEAD:`. A guard that only saw committed content would pass on
// a broken edit and fail on a fixed one until it was committed, which inverts the edit-and-rerun
// loop it exists to support.
function readTracked(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

/**
 * Normalisation over a WHOLE artifact, carrying an index back to the original text.
 *
 * Round 4 exists because the previous version split on newlines and normalised each line, so a
 * phrase wrapped by ordinary Markdown reflow matched nothing: "source is not" ending one line and
 * "published" starting the next. Normalising per line can only ever see inside a line, so no
 * additional pattern fixes it; the unit of matching has to be the artifact.
 *
 * `origin[k]` is the offset in `raw` of the k-th normalised character, which is what lets a match
 * report a real line number. Line splitting was only ever there for the diagnostic, and a line
 * number is recoverable from an offset.
 *
 * `separators` decides what collapses. FAMILY runs with hyphens and underscores treated as
 * separators, so a hyphenated run-together and a line break normalise to the same thing. COMPOUND
 * runs with whitespace only, because its hyphen is the thing it is looking for.
 */
type Normalised = { text: string; origin: number[] };

function normaliseWhole(raw: string, separators: RegExp): Normalised {
  let text = "";
  const origin: number[] = [];
  let index = 0;
  while (index < raw.length) {
    const character = raw.charAt(index);
    if (separators.test(character)) {
      text += " ";
      origin.push(index);
      while (index < raw.length && separators.test(raw.charAt(index))) index += 1;
    } else {
      text += character;
      origin.push(index);
      index += 1;
    }
  }
  return { text, origin };
}

const FAMILY_SEPARATORS = /[-_\s]/;
const COMPOUND_SEPARATORS = /\s/;

/** Kept for the single-string probes below, where there is nothing to map back to. */
function normalise(text: string): string {
  return normaliseWhole(text, FAMILY_SEPARATORS).text;
}

function lineOf(raw: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < raw.length; index += 1) {
    if (raw.charAt(index) === "\n") line += 1;
  }
  return line;
}

type Hit = { file: string; line: number; why: string };

function firstMatch(
  raw: string,
  normalised: Normalised,
  pattern: RegExp,
): { line: number } | undefined {
  const found = pattern.exec(normalised.text);
  if (found === null) return undefined;
  const offset = normalised.origin[found.index] ?? 0;
  return { line: lineOf(raw, offset) };
}

function hitsIn(file: string, raw: string): Hit[] {
  const forFamily = normaliseWhole(raw, FAMILY_SEPARATORS);
  const forCompound = normaliseWhole(raw, COMPOUND_SEPARATORS);
  const hits: Hit[] = [];
  for (const entry of FAMILY) {
    const found = firstMatch(raw, forFamily, entry.pattern);
    if (found !== undefined) hits.push({ file, line: found.line, why: entry.why });
  }
  const compound = firstMatch(raw, forCompound, COMPOUND.pattern);
  if (compound !== undefined) hits.push({ file, line: compound.line, why: COMPOUND.why });
  return hits;
}

function familyHits(files: readonly string[]): Hit[] {
  return files.flatMap((file) => hitsIn(file, readTracked(file)));
}

/**
 * Layer 1, over whole artifacts for the same reason. `git grep` matches line by line, so the wrapped
 * form that defeated layer 2 defeated this too: the shipped literal split across a newline scored
 * zero files. Measured, not assumed, before this was rewritten.
 */
function shippedPhrasingHits(phrase: string): Hit[] {
  // Matched against normalised text, where every separator run is already one space, so the phrase
  // needs no escaping beyond its own words.
  const wanted = new RegExp(normalise(phrase), "i");
  return trackedTextFiles().flatMap((file) => {
    const raw = readTracked(file);
    const found = firstMatch(raw, normaliseWhole(raw, FAMILY_SEPARATORS), wanted);
    return found === undefined ? [] : [{ file, line: found.line, why: phrase }];
  });
}

// Runs the probes through the real matcher rather than a parallel reimplementation of it. A probe
// that tested its own copy of the logic would have kept passing through all four evasions.
function caughtByFamily(wording: string): boolean {
  return hitsIn("probe", wording).length > 0;
}

describe("COVERAGE_GAP prose cannot describe an absent source", () => {
  it.each(SHIPPED_PHRASINGS)("has no tracked file saying $phrase", ({ phrase, why }) => {
    // Fails with the offending file:line and the reason, so whoever reintroduces it is told where
    // and why rather than being handed a bare boolean.
    const hits = shippedPhrasingHits(phrase).map((hit) => `${hit.file}:${hit.line}`);
    expect(hits, why).toEqual([]);
  });

  it("has no source-absence wording in the artifacts that define the status", () => {
    const hits = familyHits(scopedFiles()).map((hit) => `${hit.file}:${hit.line} ${hit.why}`);
    expect(
      hits,
      "COVERAGE_GAP means the combination is not covered, not that a source is missing",
    ).toEqual([]);
  });

  it.each(MEANING_ARTIFACTS)("%s states the published formulation", (file) => {
    // Deletion guard only. A file can satisfy this and still contradict itself elsewhere, which is
    // exactly what happened before this round, so it asserts nothing about the rest of the file.
    expect(
      REQUIRED.test(normalise(readTracked(file))),
      `${file} must state COVERAGE_GAP's published meaning`,
    ).toBe(true);
  });

  it("fires on every wording this defect has actually used", () => {
    // Guards the guard against the real history rather than a synthetic string: these are the
    // wordings that reached approved artifacts, rebuilt from fragments so this file does not trip
    // the very layer it is testing.
    const sourceNot = ["source", "not", "established"].join("-");
    const historical = [
      `an explicit ${sourceNot} coverage state`,
      `an explicit ${sourceNot} coverage gap`,
      `an explicit ${sourceNot} gap`,
      `exposes the ${sourceNot} gap`,
      `the explicit ${sourceNot} state`,
      `its explicit ${["no", "source"].join("-")} state`,
      ...SHIPPED_PHRASINGS.map((entry) => entry.phrase),
      // Round 4's evasion: the same claim broken by ordinary Markdown reflow. Every wording above
      // also gets a wrapped variant below, because the wrap is orthogonal to the wording and the
      // previous version of this guard passed on all of them.
      ...SHIPPED_PHRASINGS.map((entry) => entry.phrase.replace(" ", "\n")),
      // Assembled, not written out, for the same reason as everything else here: whole-file
      // normalisation now joins this file's own lines too, so a wrapped literal in a probe would be
      // indistinguishable from the defect and would fail the layer it exists to test.
      `an explicit state in which ${["no", "source", "is"].join(" ")}\n${"published"}`,
      `a state where the\n${["source", "is", "not", "established"].join(" ")}`,
    ];
    for (const wording of historical) {
      expect(caughtByFamily(wording), `should be caught: ${JSON.stringify(wording)}`).toBe(true);
    }
  });

  it("does not fire on prose that legitimately discusses missing sources", () => {
    // The scope decision above, asserted rather than described. If someone widens the scope to the
    // whole repo, these are the sentences that begin failing, and this test says why that is wrong:
    // a rule the evidence record and the amendment history cannot obey is the wrong rule.
    const legitimate = [
      "no primary source located in two research passes",
      "a rule that publishes no source",
      "rendering the citation without a source URL",
      "a published verification date that no source states",
    ];
    for (const wording of legitimate) {
      expect(caughtByFamily(wording), `should NOT be caught: ${wording}`).toBe(false);
    }
  });

  it("would notice if the file scan stopped working", () => {
    // A scan that silently saw nothing would let every assertion above pass forever, which is the
    // failure mode that makes a regression test worthless.
    expect(trackedTextFiles().length).toBeGreaterThan(MEANING_ARTIFACTS.length);
    expect(scopedFiles().length).toBeGreaterThan(MEANING_ARTIFACTS.length);
    expect(readTracked("docs/PRD.md").length).toBeGreaterThan(0);
  });

  it("reports the line a whole-file match came from, not the offset", () => {
    // Line splitting existed only for this diagnostic, so replacing it has to keep it. Third line of
    // the sample, and the claim is wrapped across lines two and three to prove the mapping survives
    // normalisation rather than pointing at the start of the file.
    const sample = ["first", "a state in which no", "source is published"].join("\n");
    const hits = hitsIn("sample.md", sample);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.line).toBe(2);
  });
});
