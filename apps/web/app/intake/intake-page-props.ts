import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseIntakeContract, type IntakeContract } from "@pop-engine/engine";
import { rulesFileIn } from "../rules-file";

// The questionnaire is derived from the published ruleset (AD-2): the registry is read
// on the server and handed to the form. `RULES_FILE` matches the api's variable so both
// services read the same artifact in a deployment, and matches its HANDLING too: an empty
// value means unset in both, which it did not before (`??` falls through on null and
// undefined only, so `RULES_FILE=` resolved to the working directory here and failed on a
// directory). The relative default resolves against the Next app's own directory, which is
// its working directory in dev and in build.

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
