import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalRulesFile = process.env.RULES_FILE;

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("node:fs");
  if (originalRulesFile === undefined) delete process.env.RULES_FILE;
  else process.env.RULES_FILE = originalRulesFile;
});

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

    expect(rulesFilePath()).toBe(resolve("/somewhere/else/rules.json"));
  });

  it("still scans, and still fails loudly, when no override is set", async () => {
    delete process.env.RULES_FILE;
    const { rulesFilePath } = await withUnscannableRulesDirectory();

    expect(() => rulesFilePath()).toThrow(/scandir/);
  });

  it("treats an empty RULES_FILE as unset rather than as a path", async () => {
    process.env.RULES_FILE = "";
    const { rulesFilePath } = await withUnscannableRulesDirectory();

    expect(() => rulesFilePath()).toThrow(/scandir/);
  });
});
