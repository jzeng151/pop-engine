import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(resolve(path), "utf8");
const expectedOverrides = ["postcss@8.4.31: 8.5.23", "sharp@0.34.5: 0.35.3"];

function overrideLines(yaml) {
  return (yaml.match(/^overrides:\n((?: {2}\S.*\n)+)/m)?.[1] ?? "")
    .trim()
    .split("\n")
    .map((line) => line.trim());
}

describe("F-707 production dependency security", () => {
  const workspace = read("pnpm-workspace.yaml");
  const lockfile = read("pnpm-lock.yaml");

  it("keeps the two exact workspace and lockfile overrides", () => {
    expect(overrideLines(workspace)).toEqual(expectedOverrides);
    expect(overrideLines(lockfile)).toEqual(expectedOverrides);
  });

  it("keeps the direct Next range and locked version unchanged", () => {
    const webPackage = JSON.parse(read("apps/web/package.json"));
    const webImporter = lockfile.match(/\n {2}apps\/web:\n([\s\S]*?)\n {2}packages\/engine:/)?.[1];
    expect(webPackage.dependencies.next).toBe("^15.1.4");
    expect(webImporter).toMatch(/\n {6}next:\n {8}specifier: \^15\.1\.4\n {8}version: 15\.5\.21\(/);
  });

  it("keeps every advisory-clearing package resolution", () => {
    for (const entry of [
      "brace-expansion@5.0.9",
      "nanoid@3.3.18",
      "postcss@8.5.23",
      "sharp@0.35.3",
    ]) {
      expect(lockfile).toMatch(new RegExp(`^ {2}${entry.replaceAll(".", "\\.")}:$`, "m"));
    }
    expect(lockfile).not.toMatch(/^ {2}(?:postcss@8\.4\.31|sharp@0\.34\.5):$/m);
  });
});
