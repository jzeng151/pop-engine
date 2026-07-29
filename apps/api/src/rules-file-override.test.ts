// `RULES_FILE` is the escape hatch, and it has to work in the state someone reaches for it in.
//
// The default path is DISCOVERED by scanning `rules/` for the one published artifact. That scan
// used to run at module scope, so importing `./ruleset` threw whenever the directory was empty,
// ambiguous or holding something that is not a ruleset — before anything consulted the override.
// The result was an escape hatch that failed in exactly the situation it exists for: pointing the
// api at a file BECAUSE the directory is not in the expected state.
//
// Isolated in its own file because it mocks `node:fs`, which is hoisted per module and would reach
// every other test in `ruleset.test.ts`.

import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalRulesFile = process.env.RULES_FILE;

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("node:fs");
  if (originalRulesFile === undefined) delete process.env.RULES_FILE;
  else process.env.RULES_FILE = originalRulesFile;
});

/** `./ruleset`, loaded fresh with the rules directory unreadable. */
async function withUnscannableRulesDirectory() {
  vi.resetModules();
  vi.doMock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    return {
      ...actual,
      readdirSync: () => {
        throw new Error("ENOENT: no such file or directory, scandir 'rules'");
      },
    };
  });
  return import("./ruleset");
}

describe("RULES_FILE is honored before the rules directory is scanned", () => {
  it("returns the override without scanning, when the directory cannot be scanned at all", async () => {
    process.env.RULES_FILE = "/somewhere/else/rules.json";
    const { rulesFilePath } = await withUnscannableRulesDirectory();

    // The assertion is that this does not throw. Before the reorder the module could not even be
    // imported in this state, so the override never got a chance to be read.
    expect(rulesFilePath()).toBe(resolve("/somewhere/else/rules.json"));
  });

  it("still scans, and still fails loudly, when no override is set", async () => {
    delete process.env.RULES_FILE;
    const { rulesFilePath } = await withUnscannableRulesDirectory();

    // The override is a way past the scan, not a way to disable it. With nothing to fall back on
    // the scan runs and its failure is the answer.
    expect(() => rulesFilePath()).toThrow(/scandir/);
  });

  it("treats an empty RULES_FILE as unset rather than as a path", async () => {
    // An unset variable and one exported as the empty string are the same intent, and `""` would
    // otherwise resolve to the working directory and be reported as an unreadable ruleset.
    process.env.RULES_FILE = "";
    const { rulesFilePath } = await withUnscannableRulesDirectory();

    expect(() => rulesFilePath()).toThrow(/scandir/);
  });
});
