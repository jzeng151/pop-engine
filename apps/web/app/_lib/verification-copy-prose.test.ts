import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SHIPPED_PHRASINGS: ReadonlyArray<{ phrase: string; why: string }> = [
  {
    phrase: ["source", "not", "yet", "established"].join(" "),
    why: "announces a pending source, which is RESEARCH_REQUIRED's meaning, not COVERAGE_GAP's",
  },
  {
    phrase: ["no", "source", "is", "published"].join(" "),
    why: "states the absence of a source as the status's meaning rather than its consequence",
  },
];

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

const COMPOUND = {
  pattern: new RegExp(`\\b${["no", "source"].join("-")}\\b`, "i"),
  why: "the compound form of the same claim",
};

const REQUIRED = /\bnot (?:covered|modeled|modelled) by this ruleset version\b/i;

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
    const failure = error as { status?: number; stdout?: string };
    if (failure.status === 1 && !failure.stdout) return "";
    throw error;
  }
}

function trackedTextFiles(): string[] {
  return git(["ls-files"])
    .split("\n")
    .filter(Boolean)
    .filter((file) => {
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

function readTracked(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

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

function shippedPhrasingHits(phrase: string): Hit[] {
  const wanted = new RegExp(normalise(phrase), "i");
  return trackedTextFiles().flatMap((file) => {
    const raw = readTracked(file);
    const found = firstMatch(raw, normaliseWhole(raw, FAMILY_SEPARATORS), wanted);
    return found === undefined ? [] : [{ file, line: found.line, why: phrase }];
  });
}

function caughtByFamily(wording: string): boolean {
  return hitsIn("probe", wording).length > 0;
}

describe("COVERAGE_GAP prose cannot describe an absent source", () => {
  it.each(SHIPPED_PHRASINGS)("has no tracked file saying $phrase", ({ phrase, why }) => {
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
    expect(
      REQUIRED.test(normalise(readTracked(file))),
      `${file} must state COVERAGE_GAP's published meaning`,
    ).toBe(true);
  });

  it("fires on every wording this defect has actually used", () => {
    const sourceNot = ["source", "not", "established"].join("-");
    const historical = [
      `an explicit ${sourceNot} coverage state`,
      `an explicit ${sourceNot} coverage gap`,
      `an explicit ${sourceNot} gap`,
      `exposes the ${sourceNot} gap`,
      `the explicit ${sourceNot} state`,
      `its explicit ${["no", "source"].join("-")} state`,
      ...SHIPPED_PHRASINGS.map((entry) => entry.phrase),
      ...SHIPPED_PHRASINGS.map((entry) => entry.phrase.replace(" ", "\n")),
      `an explicit state in which ${["no", "source", "is"].join(" ")}\n${"published"}`,
      `a state where the\n${["source", "is", "not", "established"].join(" ")}`,
    ];
    for (const wording of historical) {
      expect(caughtByFamily(wording), `should be caught: ${JSON.stringify(wording)}`).toBe(true);
    }
  });

  it("does not fire on prose that legitimately discusses missing sources", () => {
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
    expect(trackedTextFiles().length).toBeGreaterThan(MEANING_ARTIFACTS.length);
    expect(scopedFiles().length).toBeGreaterThan(MEANING_ARTIFACTS.length);
    expect(readTracked("docs/PRD.md").length).toBeGreaterThan(0);
  });

  it("reports the line a whole-file match came from, not the offset", () => {
    const sample = ["first", "a state in which no", "source is published"].join("\n");
    const hits = hitsIn("sample.md", sample);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.line).toBe(2);
  });
});
