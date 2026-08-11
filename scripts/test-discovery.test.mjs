import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

import { expect, test } from "vitest";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function discoveredFiles() {
  const listed = spawnSync(
    "node",
    ["node_modules/vitest/vitest.mjs", "list", "--config", "vitest.config.ts", "--filesOnly"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  expect(listed.status, listed.stderr).toBe(0);
  return listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

test("the co-firing suite is the only thing under `scripts/` the required run leaves out", () => {
  const files = discoveredFiles();
  expect(files).toContain("scripts/check-baseline-drift.test.mjs");
  expect(files).toContain("scripts/spec-conflict-resolutions.test.mjs");
  expect(files.filter((file) => file.startsWith("scripts/dedupe-cofiring/"))).toEqual([]);
});

test("a script guard in a subdirectory is part of the required run", () => {
  const planted = mkdtempSync(join(repoRoot, "scripts", "planted-"));
  try {
    writeFileSync(
      join(planted, "guard.test.mjs"),
      'import { test } from "vitest";\ntest("planted", () => {});\n',
    );
    const expected = `${relative(repoRoot, planted).split("\\").join("/")}/guard.test.mjs`;
    expect(discoveredFiles()).toContain(expected);
  } finally {
    rmSync(planted, { recursive: true, force: true });
  }
});
