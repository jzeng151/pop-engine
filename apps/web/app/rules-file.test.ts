import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishedRulesFileIn, rulesFileIn } from "./rules-file";

const directories: string[] = [];

const rulesDirectoryWith = (entries: Record<string, string>): string => {
  const directory = mkdtempSync(join(tmpdir(), "pop-rules-"));
  directories.push(directory);
  for (const [name, contents] of Object.entries(entries)) {
    writeFileSync(join(directory, name), contents);
  }
  return directory;
};

const fixtureRuleset = (version: string): string => ["nyc", `rules.${version}.json`].join("-");

const FIXTURE = fixtureRuleset("v0.1");
const SECOND_FIXTURE = fixtureRuleset("v0.2");
const THIRD_FIXTURE = fixtureRuleset("v0.3");

const UNVERSIONED = ["nyc", "rules.json"].join("-");

const FIXTURE_VERSION = "nyc.v0.1";

const ruleset = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({ schema: "popengine-rules/v2", ruleset_version: FIXTURE_VERSION, ...overrides });

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("finding the published ruleset", () => {
  it("returns the one published ruleset whatever version it names", () => {
    for (const name of [FIXTURE, SECOND_FIXTURE, THIRD_FIXTURE]) {
      const directory = rulesDirectoryWith({ [name]: ruleset() });
      expect(publishedRulesFileIn(directory)).toBe(join(directory, name));
    }
  });

  it("ignores entries that are not published rulesets", () => {
    const directory = rulesDirectoryWith({
      [FIXTURE]: ruleset(),
      "README.md": "not a ruleset",
      [UNVERSIONED]: ruleset(),
    });
    expect(publishedRulesFileIn(directory)).toBe(join(directory, FIXTURE));
  });

  it("refuses to choose when the directory is empty or ambiguous", () => {
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
    const directory = rulesDirectoryWith({ [FIXTURE]: '{"schema": "popengine-rul' });
    expect(() => publishedRulesFileIn(directory)).toThrow(/is not readable JSON/);
  });

  it("refuses JSON that does not declare itself a ruleset", () => {
    for (const contents of ["[]", '"a string"', "null", '{"rules": []}', '{"schema": 7}']) {
      const directory = rulesDirectoryWith({ [FIXTURE]: contents });
      expect(() => publishedRulesFileIn(directory), contents).toThrow(/not a published ruleset/);
    }
  });

  it("refuses a ruleset-shaped file carrying no version", () => {
    for (const version of [undefined, "", 2.8, null]) {
      const directory = rulesDirectoryWith({ [FIXTURE]: ruleset({ ruleset_version: version }) });
      expect(() => publishedRulesFileIn(directory), String(version)).toThrow(
        /carries no ruleset_version/,
      );
    }
  });

  it("accepts a schema version it does not know, leaving that judgement to the parser", () => {
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
    process.env.RULES_FILE = "/somewhere/else/rules.json";
    expect(rulesFileIn(rulesDirectoryWith({}))).toBe("/somewhere/else/rules.json");
  });

  it("falls back to the published artifact when nothing is set", () => {
    delete process.env.RULES_FILE;
    const directory = rulesDirectoryWith({ [FIXTURE]: ruleset() });
    expect(rulesFileIn(directory)).toBe(join(directory, FIXTURE));
  });

  it("treats an empty RULES_FILE as unset, the way apps/api does", () => {
    process.env.RULES_FILE = "";
    const directory = rulesDirectoryWith({ [FIXTURE]: ruleset() });
    expect(rulesFileIn(directory)).toBe(join(directory, FIXTURE));
  });

  it("still fails loudly on an unusable directory when there is nothing to fall back to", () => {
    delete process.env.RULES_FILE;
    expect(() => rulesFileIn(rulesDirectoryWith({}))).toThrow(/found 0/);
    process.env.RULES_FILE = "";
    expect(() => rulesFileIn(rulesDirectoryWith({}))).toThrow(/found 0/);
  });
});
