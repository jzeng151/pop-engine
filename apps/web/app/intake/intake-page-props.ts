import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseIntakeContract, type IntakeContract } from "@pop-engine/engine";
import { rulesFileIn } from "../rules-file";

// The questionnaire is derived from the published ruleset (AD-2): the registry is read on the server and handed to the form.

export async function intakeFormProps(): Promise<{
  contract: IntakeContract;
  apiBaseUrl: string;
}> {
  const rulesFile = resolve(rulesFileIn("../../rules"));
  return {
    contract: parseIntakeContract(JSON.parse(await readFile(rulesFile, "utf8"))),
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001",
  };
}
