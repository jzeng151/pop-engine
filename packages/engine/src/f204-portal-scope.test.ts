import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEngineRuleset } from "./index";
import { PUBLISHED_RULES_FILE } from "./__fixtures__/published-ruleset";

const RAW = readFileSync(PUBLISHED_RULES_FILE, "utf8");
const DOCUMENT = JSON.parse(RAW) as Record<string, unknown>;
const RULESET = parseEngineRuleset(DOCUMENT);

const ruleOf = (id: string) => {
  const rule = RULESET.rules.find((candidate) => candidate.id === id);
  if (rule === undefined) throw new Error(`${id} is not in ${PUBLISHED_RULES_FILE}`);
  return rule;
};

const NO_PORTAL_RULE_IDS = [
  "DOHMH-ORGANIZER-NOTIFY-001",
  "DOHMH-VENDOR-PERMIT-001",
  "SLA-ONEDAY-001",
  "SLA-CATERING-001",
] as const;

describe("SPEC-CONFLICT #149 · F-204 portals only where the ruleset publishes them", () => {
  it.each(NO_PORTAL_RULE_IDS)("%s publishes no portal fields", (ruleId) => {
    const rule = ruleOf(ruleId);
    expect(rule.portalName).toBeNull();
    expect(rule.portalUrl).toBeNull();
    expect(rule.portalInstructions).toBeNull();
  });

  it("keeps the SLA citation URL on source without promoting it to a portal", () => {
    for (const ruleId of ["SLA-ONEDAY-001", "SLA-CATERING-001"] as const) {
      const rule = ruleOf(ruleId);
      expect(rule.source?.urls).toContain("https://sla.ny.gov/permits-available-online");
      expect(rule.portalUrl).toBeNull();
      expect(rule.portalName).toBeNull();
    }
  });

  it("does not carry required_documents (or camelCase) anywhere in the published artifact", () => {
    expect(RAW.includes("required_documents")).toBe(false);
    expect(RAW.includes("requiredDocuments")).toBe(false);
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const entry of value) walk(entry);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        expect(key === "required_documents" || key === "requiredDocuments").toBe(false);
        walk(child);
      }
    };
    walk(DOCUMENT);
  });
});
