// The resolver that finds the published ruleset instead of naming it, and the check that what it
// found is actually a ruleset.
//
// Both halves are asserted here because both are load-bearing and neither is obvious from reading
// the call sites. Discovery is what stops a version bump silently emptying seven suites; the
// identity check is the price of discovery — a named path failed loudly when the file was missing,
// while a directory scan happily returns any file whose NAME fits.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishedRulesFileIn, rulesFileIn } from "./rules-file";

const directories: string[] = [];

/** A throwaway `rules/` holding exactly the entries a case needs. */
const rulesDirectoryWith = (entries: Record<string, string>): string => {
  const directory = mkdtempSync(join(tmpdir(), "pop-rules-"));
  directories.push(directory);
  for (const [name, contents] of Object.entries(entries)) {
    writeFileSync(join(directory, name), contents);
  }
  return directory;
};

/**
 * Fixture ruleset names, ASSEMBLED rather than written out, and that is not stylistic.
 *
 * This file creates temp directories and fills them with files whose names have to LOOK like
 * published rulesets for the resolver to consider them. They are not references to the repository
 * artifact and never were. Written as literals they spelled the current version, which meant
 * `check:baseline` read twelve of them as paths into `rules/` and passed only because that version
 * happened to still be on disk. Publishing v2.9 and deleting v2.8 would have turned every one into
 * a dangling reference and failed the guard on a file that is correct — the guard built to make a
 * bump safe, blocking the bump.
 *
 * So the names are built from a version this repo will never publish, and nothing here needs
 * editing when one is. Assembly is also what keeps them out of the check's reach: it reads string
 * literals and deliberately does not fold expressions, which is the documented gap
 * `scripts/check-baseline-drift.test.mjs` relies on for the same reason. Do not tidy these back
 * into literals. The names must stay fictional for these tests to mean anything, and a literal one
 * would tie this file to a publication all over again.
 */
const fixtureRuleset = (version: string): string => ["nyc", `rules.${version}.json`].join("-");

/** Three versions that exist nowhere, so a case needing several distinct names has them. */
const FIXTURE = fixtureRuleset("v0.1");
const SECOND_FIXTURE = fixtureRuleset("v0.2");
const THIRD_FIXTURE = fixtureRuleset("v0.3");

/** A ruleset-shaped name the published pattern must NOT match, because it carries no version. */
const UNVERSIONED = ["nyc", "rules.json"].join("-");

/** The version the fixture documents carry. Synthetic, and far from any published one. */
const FIXTURE_VERSION = "nyc.v0.1";

const ruleset = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({ schema: "popengine-rules/v2", ruleset_version: FIXTURE_VERSION, ...overrides });

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("finding the published ruleset", () => {
  it("returns the one published ruleset whatever version it names", () => {
    // The point of the whole change: the resolver has no opinion about which version is current,
    // so a bump moves one file and sweeps nothing.
    for (const name of [FIXTURE, SECOND_FIXTURE, THIRD_FIXTURE]) {
      const directory = rulesDirectoryWith({ [name]: ruleset() });
      expect(publishedRulesFileIn(directory)).toBe(join(directory, name));
    }
  });

  it("ignores entries that are not published rulesets", () => {
    // `rules/` also holds `proposals/` and may hold anything else; only the published artifact
    // matches the name pattern.
    const directory = rulesDirectoryWith({
      [FIXTURE]: ruleset(),
      "README.md": "not a ruleset",
      [UNVERSIONED]: ruleset(),
    });
    expect(publishedRulesFileIn(directory)).toBe(join(directory, FIXTURE));
  });

  it("refuses to choose when the directory is empty or ambiguous", () => {
    // Picking one of two would put every permit fact on screen behind an artifact nobody chose,
    // and the page would look entirely normal doing it.
    expect(() => publishedRulesFileIn(rulesDirectoryWith({}))).toThrow(/found 0/);
    expect(
      () =>
        publishedRulesFileIn(
          rulesDirectoryWith({ [FIXTURE]: ruleset(), [SECOND_FIXTURE]: ruleset() }),
        ),
      // Named in sorted order, so the message is stable whatever the directory hands back.
    ).toThrow(new RegExp(`found 2: ${FIXTURE}, ${SECOND_FIXTURE}`.replace(/\./g, "\\.")));
  });
});

describe("checking that what was found is a ruleset", () => {
  it("refuses a file whose name fits but whose bytes are not a document", () => {
    // The truncated download and the half-written publish. A named path could not reach this state
    // without failing to open; discovery can, which is the cost this check pays for.
    const directory = rulesDirectoryWith({ [FIXTURE]: '{"schema": "popengine-rul' });
    expect(() => publishedRulesFileIn(directory)).toThrow(/is not readable JSON/);
  });

  it("refuses JSON that does not declare itself a ruleset", () => {
    // A merge artefact, or a proposal draft copied into `rules/` under a published name.
    for (const contents of ["[]", '"a string"', "null", '{"rules": []}', '{"schema": 7}']) {
      const directory = rulesDirectoryWith({ [FIXTURE]: contents });
      expect(() => publishedRulesFileIn(directory), contents).toThrow(/not a published ruleset/);
    }
  });

  it("refuses a ruleset-shaped file carrying no version", () => {
    // `ruleset_version` is what separates a published artifact from a fragment, and it is the field
    // plans persist for AD-7 replay.
    for (const version of [undefined, "", 2.8, null]) {
      const directory = rulesDirectoryWith({ [FIXTURE]: ruleset({ ruleset_version: version }) });
      expect(() => publishedRulesFileIn(directory), String(version)).toThrow(
        /carries no ruleset_version/,
      );
    }
  });

  it("accepts a schema version it does not know, leaving that judgement to the parser", () => {
    // Matched on the family rather than on `popengine-rules/v2` exactly. Pinning the token here
    // would put a second copy of the parser's compatibility decision in a file with no business
    // making it — and would turn a schema bump into the same sweep this change exists to remove.
    const directory = rulesDirectoryWith({ [FIXTURE]: ruleset({ schema: "popengine-rules/v9" }) });
    expect(publishedRulesFileIn(directory)).toBe(join(directory, FIXTURE));
  });

  it("names the file it rejected, so the message points at the artifact and not at the reader", () => {
    const directory = rulesDirectoryWith({ [FIXTURE]: "{}" });
    expect(() => publishedRulesFileIn(directory)).toThrow(
      new RegExp(join(directory, FIXTURE).replace(/\./g, "\\.")),
    );
  });
});

describe("choosing between the RULES_FILE override and the published artifact", () => {
  const originalRulesFile = process.env.RULES_FILE;

  afterEach(() => {
    if (originalRulesFile === undefined) delete process.env.RULES_FILE;
    else process.env.RULES_FILE = originalRulesFile;
  });

  it("uses the override when one is set, without looking in the directory", () => {
    // The escape hatch has to work in the state someone reaches for it in, which is a rules
    // directory that cannot answer. An empty one would throw if it were consulted.
    process.env.RULES_FILE = "/somewhere/else/rules.json";
    expect(rulesFileIn(rulesDirectoryWith({}))).toBe("/somewhere/else/rules.json");
  });

  it("falls back to the published artifact when nothing is set", () => {
    delete process.env.RULES_FILE;
    const directory = rulesDirectoryWith({ [FIXTURE]: ruleset() });
    expect(rulesFileIn(directory)).toBe(join(directory, FIXTURE));
  });

  it("treats an empty RULES_FILE as unset, the way apps/api does", () => {
    // `??` used to let this through, because it falls back on null and undefined only. Nothing
    // intends `RULES_FILE=`: it is what a declared-but-unvalued variable becomes, it selects no
    // outcome that differs from unset, and as a path it resolves to the working directory and
    // fails on a directory. Same variable, same handling, both services.
    process.env.RULES_FILE = "";
    const directory = rulesDirectoryWith({ [FIXTURE]: ruleset() });
    expect(rulesFileIn(directory)).toBe(join(directory, FIXTURE));
  });

  it("still fails loudly on an unusable directory when there is nothing to fall back to", () => {
    // The override is a way past the discovery, not a way to switch it off.
    delete process.env.RULES_FILE;
    expect(() => rulesFileIn(rulesDirectoryWith({}))).toThrow(/found 0/);
    process.env.RULES_FILE = "";
    expect(() => rulesFileIn(rulesDirectoryWith({}))).toThrow(/found 0/);
  });
});
