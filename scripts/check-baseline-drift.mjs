#!/usr/bin/env node
// Baseline status-drift check (governance §3; regression guard for issue #70).
//
// Invariant: any artifact the manifest (docs/BASELINE.md) marks APPROVED must
// self-declare APPROVED in its own status header. Ratifying via the manifest
// while leaving a file's header at PROPOSED/DRAFT/"Canonical" is the exact drift
// that blocked issue #2. Governance §3 also bans "Canonical"/"current"/"single
// source of truth" as statuses, so an APPROVED row whose header uses one of those
// words fails too.
//
// Scope is deliberately narrow: it only enforces APPROVED rows. PROPOSED/ARCHIVED
// rows and glob rows (e.g. specs/F-*.md) are not checked here.
//
// It also recomputes any `sha256 \`<digest>\`` a row publishes beside its artifact path
// (ARCHITECTURE-FUTURE §14 step 5: an artifact is published with a checksum before this
// manifest is updated). A digest nobody recomputes is a claim rather than a check, so an
// artifact edited without republishing, or a row left on a stale digest, fails here.
//
// Run: node scripts/check-baseline-drift.mjs   (wired into CI as `pnpm check:baseline`)

import { readFileSync, existsSync, readdirSync } from "node:fs";
import ts from "typescript";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

/**
 * The tree to check. Defaults to this repo, which is the only thing CI and a developer ever want.
 *
 * `BASELINE_CHECK_ROOT` exists so the test suite can point the REAL script at a planted tree rather
 * than testing a copy of it. It is the smallest affordance that makes these rules provable: the
 * alternatives were copying the script into a temp directory, which verifies a copy and not the
 * file CI runs, or wrapping every rule in exported functions, which is the restructure this did not
 * need. Nothing in the repo sets it.
 */
const repoRoot = process.env.BASELINE_CHECK_ROOT
  ? resolve(process.env.BASELINE_CHECK_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(repoRoot, "docs/BASELINE.md");

/**
 * Expand a manifest glob (`specs/F-*.md`) to the files it actually covers.
 *
 * Globs used to be skipped, which is exactly how "APPROVED except F-101/F-102/F-201" sat stale in
 * the specs row from the day the file was created until someone read it this week: the row claimed
 * a status for twelve files and the check looked at none of them. Only the one shape the manifest
 * uses is supported — a `*` in the filename, not a path — so an unexpected pattern is reported
 * rather than silently matching nothing.
 */
function expandGlob(token) {
  const slash = token.lastIndexOf("/");
  const directory = slash === -1 ? "" : token.slice(0, slash);
  const pattern = token.slice(slash + 1);
  if (directory.includes("*") || (pattern.match(/\*/g) ?? []).length !== 1) return null;
  const [prefix, suffix] = pattern.split("*");
  const absoluteDirectory = join(repoRoot, directory);
  if (!existsSync(absoluteDirectory)) return [];
  return readdirSync(absoluteDirectory)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => (directory === "" ? name : `${directory}/${name}`))
    .sort();
}

/** Pull backticked local .md/.json paths out of a manifest table row, expanding globs. */
function filePathsInRow(row) {
  const paths = [];
  for (const match of row.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim().replace(/^\//, ""); // `/AGENTS.md` -> AGENTS.md
    if (token.includes("*")) {
      const expanded = expandGlob(token);
      if (expanded === null) {
        unsupportedGlobs.push(token);
        continue;
      }
      // A glob matching nothing means the row claims APPROVED for a set of artifacts and the
      // check then inspects none of them. A guard that silently stops guarding is the failure
      // this whole file exists to prevent, so an empty expansion is drift, not a pass.
      if (expanded.length === 0) {
        emptyGlobs.push(token);
        continue;
      }
      paths.push(...expanded);
      continue;
    }
    if (/^[\w./-]+\.(md|json)$/.test(token)) paths.push(token);
  }
  return paths;
}

/** Extract a file's self-declared status token, or null if it declares none. */
function declaredStatus(absPath) {
  const text = readFileSync(absPath, "utf8");
  if (absPath.endsWith(".json")) {
    const status = JSON.parse(text).status;
    return typeof status === "string" ? status : null;
  }
  const line = text.split(/\r?\n/).find((l) => /^\*\*Status:\*\*/i.test(l));
  return line ? line.replace(/^\*\*Status:\*\*/i, "").trim() : null;
}

const baseline = readFileSync(baselinePath, "utf8");

// The row loop below skips every line that is not a table row, so a merge that commits conflict
// markers leaves the manifest malformed and this check green — which is how `<<<<<<< HEAD` reached
// main in 370be18. A marker means two versions of an approved row are both present and neither is
// authoritative, so the manifest cannot be read at all: fail before inspecting anything.
const conflictMarkers = baseline
  .split(/\r?\n/)
  .map((line, index) => ({ line, number: index + 1 }))
  .filter(({ line }) => /^(<{7}|={7}|>{7})(\s|$)/.test(line));
if (conflictMarkers.length > 0) {
  for (const { line, number } of conflictMarkers) {
    console.error(`docs/BASELINE.md:${number} unresolved merge conflict marker: ${line}`);
  }
  console.error("The baseline manifest is malformed; resolve the conflict before it can be read.");
  process.exit(1);
}

const approvedFiles = new Set();
const unsupportedGlobs = [];
const emptyGlobs = [];
/** Rows publishing a digest: `{ file, expected, row, malformed? }`. */
const checksumClaims = [];
for (const row of baseline.split(/\r?\n/)) {
  if (!row.startsWith("|")) continue;
  const cells = row.split("|").map((c) => c.trim());
  // cells[0] is empty (leading pipe); status is the 3rd content column.
  const statusCell = cells[3] ?? "";
  if (!/APPROVED/i.test(statusCell)) continue;
  const paths = filePathsInRow(row);
  for (const p of paths) approvedFiles.add(p);

  // A digest belongs to the artifact named in the same row, so the pairing is positional
  // rather than guessed: one path and one digest, or the row is ambiguous and says so.
  // Presence and validity are found SEPARATELY, on purpose. Matching only well-formed digests
  // meant a row whose digest lost a character matched nothing, read as "publishes no checksum",
  // and passed — a guard that stops guarding when its input is malformed, which is the same shape
  // as the empty-glob case above and the reason that one fails rather than inspecting nothing. So
  // `\bsha256\b` finds the CLAIM (it does not match "sha256sum" in prose) and the length and
  // alphabet are checked afterwards, where a bad value fails distinctly from an absent one.
  const claimed = [...row.matchAll(/\bsha256\b\s*`?([^`|\s]*)`?/gi)].map((m) => m[1] ?? "");
  if (claimed.length === 0) continue;
  const malformed = claimed.filter((value) => !/^[0-9a-fA-F]{64}$/.test(value));
  if (malformed.length > 0) {
    checksumClaims.push({
      file: null,
      expected: null,
      row: cells[1] ?? row.slice(0, 60),
      malformed: malformed.map((value) => `"${value}" (${value.length} chars)`).join(", "),
    });
    continue;
  }
  const digests = claimed.map((value) => value.toLowerCase());
  if (digests.length !== 1 || paths.length !== 1) {
    checksumClaims.push({ file: null, expected: null, row: cells[1] ?? row.slice(0, 60) });
    continue;
  }
  checksumClaims.push({ file: paths[0], expected: digests[0], row: cells[1] ?? "" });
}

const bannedLeadWords = /^(PROPOSED|DRAFT|Canonical|Current|Single)\b/i;
const failures = [];
const checked = [];
const headerless = [];

for (const rel of [...approvedFiles].sort()) {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) continue; // manifest may reference not-yet-created files
  const status = declaredStatus(abs);
  if (status === null) {
    // Warn, do not fail. A file that declares nothing cannot contradict the manifest, and failing
    // here would break the build until someone writes approval dates for nine spec files that
    // nobody can date honestly. A file that declares the WRONG status still fails below: a
    // contradiction is drift, silence is a gap. Governance §7 wants the headers; this counts them
    // until they exist.
    headerless.push(rel);
    continue;
  }
  checked.push(rel);
  if (!/^APPROVED\b/i.test(status)) {
    failures.push(
      `${rel}: manifest says APPROVED, header says "${status.slice(0, 80)}"` +
        (bannedLeadWords.test(status) ? "  (governance §3: not a valid status)" : ""),
    );
  }
}

const checksumFailures = [];
for (const claim of checksumClaims) {
  if (claim.malformed !== undefined) {
    checksumFailures.push(
      `${claim.row}: sha256 claim is not 64 hex characters: ${claim.malformed}` +
        "  (a malformed digest fails; it never reads as no digest)",
    );
    continue;
  }
  if (claim.file === null) {
    checksumFailures.push(
      `${claim.row}: row publishes a sha256 but does not name exactly one artifact, so the digest ` +
        `cannot be attributed to a file`,
    );
    continue;
  }
  const abs = join(repoRoot, claim.file);
  if (!existsSync(abs)) {
    checksumFailures.push(`${claim.file}: row publishes a sha256 for a file that is not there`);
    continue;
  }
  // Over the exact bytes on disk. Nothing is parsed, normalised or reserialised: the digest has to
  // describe the artifact a deployment loads, not a reformatting of it.
  const actual = createHash("sha256").update(readFileSync(abs)).digest("hex");
  if (actual !== claim.expected) {
    checksumFailures.push(
      `${claim.file}: manifest says sha256 ${claim.expected}, file is ${actual}` +
        "  (edited without republishing, or the row is stale)",
    );
  }
}

if (checksumFailures.length > 0) {
  console.error("Baseline manifest publishes a checksum that does not match its artifact:\n");
  for (const failure of checksumFailures) console.error("  ✗ " + failure);
  console.error(
    "\nA published artifact is immutable (ARCHITECTURE-FUTURE §14): a changed ruleset is a new " +
      "version with a new row, never an edit in place. Recompute with `sha256sum <path>`.",
  );
  process.exit(1);
}

if (emptyGlobs.length > 0) {
  console.error("Baseline manifest marks a glob APPROVED that matches no file:\n");
  for (const glob of emptyGlobs) console.error("  ✗ " + glob);
  console.error(
    "\nThe row claims a status for artifacts that are not there. Either the files moved and the " +
      "manifest must follow, or the row is stale — the check will not pass by inspecting nothing.",
  );
  process.exit(1);
}

if (unsupportedGlobs.length > 0) {
  console.error("Baseline manifest uses a glob shape this check cannot expand:\n");
  for (const glob of unsupportedGlobs) console.error("  ✗ " + glob);
  console.error("\nSupported: a single * in the filename, e.g. specs/F-*.md.");
  process.exit(1);
}

// ── Ruleset references in executable code ───────────────────────────────────────────────────────
//
// Invariant: every ruleset artifact that executable code names must exist, and the one constant
// allowed to pin a version must pin the published one.
//
// This is a regression guard for the day main went red. `apps/web/app/checklist/checklist-fixtures.ts`
// defaulted to `rules/nyc-rules.v2.7.json`; publishing v2.8 deleted that file; the read is at module
// scope, so two suites failed to IMPORT rather than failing a test. Neither PR could have caught it
// — each was green against a main that did not contain the other, and a version bump structurally
// cannot grep for references that land after it runs. Only a check on the merged tree can.
//
// WHY THIS RULE AND NOT "flag any unpublished version string". A version string in code is very
// often legitimate and cannot break on a bump: `compareToPinned("nyc.v2.3", "nyc.v2.1")` is test
// data, and `packages/engine/src/ruleset.ts` deliberately keeps a table of the pre-v2.4 versions it
// supplies defaults for, because old plans must still replay. Flagging those would be unsound and
// would bury the real thing in noise. A PATH is different in kind: it is a claim about the
// filesystem, and a publication can invalidate it silently. So paths are checked, and the sole
// version constant is checked against the artifact rather than forbidden.
//
// Scope is executable code only. `docs/` and `specs/` cite superseded versions in prose everywhere,
// and BASELINE's lineage rows cite them WITH their commits on purpose — that is the recovery trail,
// and a check that broke it would be removing a feature to add a guard.

// Every extension the toolchain can execute. The first four were the ones the repo happened to
// contain; the rest are not hypothetical, they are the shapes a file can take TOMORROW without
// anyone thinking to revisit this list. A `.mts` config or a `.cjs` script naming a deleted ruleset
// would have been invisible to a check whose whole purpose is that references cannot hide.
const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js", ".jsx"];

/**
 * The directories that are not this repo's source, READ FROM `.gitignore` rather than listed here.
 *
 * The list used to be written by hand, and it held `build`. Nothing in this repo ignores `build`,
 * so `apps/api/src/build/reader.ts` is an ordinary tracked source file — and the walker pruned it
 * by BASENAME at any depth, so that file could name an absent ruleset and this check exited 0. It
 * also reported a smaller file count on its way past, which is the worse half: a guard that quietly
 * scans less reads exactly like a clean repo, and that is the failure mode this file has closed
 * three times elsewhere. The count is now part of the diagnostic for that reason.
 *
 * Deriving it removes the class rather than the one bad entry. A tree that is genuinely build
 * output is gitignored, because otherwise it would be committed; a tree that is not gitignored is
 * source by definition, whatever it is called. So the two facts cannot drift apart any more, and
 * nobody has to remember to keep them together. Only bare directory entries are taken (`dist/`,
 * not `apps/web/dist/` or `*.tsbuildinfo`), which is exactly the "any depth" form git itself
 * applies, so this prunes where git prunes and nowhere else.
 *
 * WHEN `.gitignore` IS ABSENT the set falls back to the two names that are never source under any
 * convention, and the direction of that fallback is the point: a smaller prune set scans MORE, so
 * a missing file makes this check noisier and never quieter. A fallback that scanned less would be
 * the silent narrowing above, arrived at by a different route.
 */
const ALWAYS_SKIPPED = ["node_modules", ".git"];
const gitignoreLines = () => {
  const gitignore = join(repoRoot, ".gitignore");
  if (!existsSync(gitignore)) return [];
  return readFileSync(gitignore, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
};
const skippedDirectories = () => {
  const declared = gitignoreLines()
    .filter((line) => line.endsWith("/"))
    .map((line) => line.slice(0, -1))
    .filter((name) => name !== "" && !name.includes("/") && !name.includes("*"));
  return new Set([...ALWAYS_SKIPPED, ...declared]);
};
const SKIPPED_DIRECTORIES = skippedDirectories();

/**
 * Whether `.gitignore` says a FILE is not part of this repo, negations honoured.
 *
 * Round 10 derived the skipped DIRECTORIES from `.gitignore` and stopped there, which left the file
 * half of the same question unasked. The README tells a developer to copy `apps/api/.env.example`
 * to `apps/api/.env`; that copy is gitignored, was still scanned, and a perfectly ordinary local
 * override like `RULES_FILE=/tmp/nyc-rules.v2.8.json` was rejected because `resolves` only knows
 * this repo's rules directories. So following the documented setup instructions made
 * `pnpm check:baseline` fail on a clean tree, over a file the repo deliberately does not track,
 * naming a path that exists. That is worse than failing at publish time: it hits everyone who sets
 * the project up.
 *
 * DERIVED RATHER THAN TRACKED-ONLY, and the difference matters. Asking git for tracked files would
 * also close this, and it would additionally skip a file that is merely NEW — one a developer has
 * written and not yet added is exactly the file a reference check should be reading. It would also
 * need git present and a real repository, which the planted trees this suite is built from are not,
 * and reading something the trees lack is the round 7 mistake. `.gitignore` answers the question
 * that is actually being asked, which is not "is this committed" but "does this repo consider this
 * file part of itself".
 *
 * Only basename patterns are taken, which is the form git applies at any depth, and `!` negation is
 * honoured, so `.env*` skips `apps/api/.env` while `!.env.example` keeps the committed template in
 * scope. The template is the one that goes stale and it is still checked.
 */
const asBasenamePattern = (pattern) =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.+^${}()|[\]\\?]/g, "\\$&"))
      .join("[^/]*")}$`,
  );
const ignoredFiles = () => {
  const lines = gitignoreLines().filter((line) => !line.endsWith("/"));
  const patterns = (prefixed) =>
    lines
      .filter((line) => line.startsWith("!") === prefixed)
      .map((line) => (prefixed ? line.slice(1) : line))
      .filter((line) => line !== "" && !line.includes("/"))
      .map(asBasenamePattern);
  return { ignored: patterns(false), kept: patterns(true) };
};
const IGNORED_FILES = ignoredFiles();
const isIgnoredFile = (name) =>
  IGNORED_FILES.ignored.some((pattern) => pattern.test(name)) &&
  !IGNORED_FILES.kept.some((pattern) => pattern.test(name));

/**
 * Every file under `directory` that `matches`, skipping the trees that are not this repo's source.
 *
 * One walker for both rules, and `node_modules` is the reason it is shared rather than duplicated:
 * a recursive read that does not skip it descends through pnpm's symlinked workspace copies and
 * reports `node_modules/.pnpm/node_modules/api/.env.example` beside the real file. Observed, not
 * anticipated — the config rule below found it on its first run.
 */
function filesUnder(directory, matches, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) filesUnder(full, matches, found);
    } else if (!isIgnoredFile(entry.name) && matches(full.slice(repoRoot.length + 1), entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * What the runtime counts as a published ruleset. A COPY of the three discoverers' pattern, and
 * the copy is deliberate after trying not to make one.
 *
 * This check restated the pattern as `^nyc-rules\..+\.json$`, which is broader than
 * `apps/api/src/ruleset.ts`, `apps/web/app/rules-file.ts` and
 * `packages/engine/src/__fixtures__/published-ruleset.ts`, all of which require the `v`. A
 * publication of `nyc-rules.2.9.json` — no `v`, field and pin in order — passed this check and then
 * found ZERO published rulesets at boot. A green guard on a tree that cannot start is the exact
 * failure this file exists to prevent, so the guard must not be able to disagree with the thing it
 * guards.
 *
 * READING IT OUT OF THE RUNTIME WAS TRIED AND REVERTED, which is worth recording so nobody spends
 * the afternoon again. The check already parses TypeScript, so lifting the declaration out of
 * `apps/api/src/ruleset.ts` costs nothing and removes the copy entirely. It also makes this check
 * unable to run against a tree that does not contain that file — and every test in this file's
 * suite works by planting a MINIMAL tree and pointing the real script at it. Twenty-seven of
 * thirty-one went red, not because the rule was wrong but because a guard that requires the whole
 * app to be present cannot be tested on anything smaller. The copy is the lesser cost, and
 * `runtimePatternsAgree` in the suite is what stops it drifting: it reads all three runtime
 * declarations and this one, and fails if any two differ.
 */
const PUBLISHED_RULESET = /^nyc-rules\.v.+\.json$/;

/**
 * What the repo actually publishes, so the message can say so rather than only what is wrong.
 *
 * Computed on first use rather than at module scope, because reading the runtime's pattern goes
 * through the parser and the parser's `SCRIPT_KINDS` table is declared further down this file. A
 * `const` initialised here would reach it before it exists.
 */
let publishedCache = null;
const publishedRulesets = () => {
  publishedCache ??= readdirSync(join(repoRoot, "rules")).filter((entry) =>
    PUBLISHED_RULESET.test(entry),
  );
  return publishedCache;
};

/**
 * Where a named ruleset must exist for a reference to it to resolve.
 *
 * Two directories publish files matching `nyc-rules.*.json` and they are not interchangeable:
 * `rules/` holds the ONE published artifact the product loads, and
 * `packages/engine/src/__fixtures__` holds superseded rulesets kept so old plans replay. A flat set
 * of every name anywhere let a fixture satisfy a production path: a reference to
 * `rules/nyc-rules.v2.3.json` passed because a same-named replay fixture existed, while the file
 * the code would actually open was not there. That is not a lexing problem and was not fixed by
 * parsing; it is this set conflating two directories, and it is fixed by asking where the reference
 * points rather than only what it is called.
 */
const RULESET_DIRECTORIES = [
  { prefix: "rules", names: publishedRulesets },
  {
    prefix: "packages/engine/src/__fixtures__",
    names: () =>
      existsSync(join(repoRoot, "packages/engine/src/__fixtures__"))
        ? readdirSync(join(repoRoot, "packages/engine/src/__fixtures__"))
        : [],
  },
];

/**
 * Whether `named`, appearing at `at` inside `text`, names a file that exists where it points.
 *
 * The directory is read from the path written around the name, which is what a reader and a runtime
 * both go by, and then reduced to its LAST SEGMENT. That reduction is the fix: `rules`, `./rules`,
 * `../../rules` and `rules//` all point at the published directory and all now say so, while a
 * directory that is neither of the two places rulesets live is rejected instead of being treated as
 * `rules/` by default.
 *
 * The default was the bug. A path in any unrecognised directory was validated against `rules/`
 * merely for not containing `__fixtures__`, so `elsewhere/nyc-rules.v2.8.json` passed while naming
 * nothing that exists anywhere. The earlier note admitted a limit here and understated it: the
 * limit was not "some directories are not distinguished", it was "every directory except one is
 * treated as `rules/`".
 *
 * A reference carrying no directory at all is still held to the published `rules/` artifact,
 * because that is what an unqualified ruleset name means in this repo and in a config line.
 */
function resolves(named, text, at) {
  const before = text.slice(0, at);
  const written = /([\w./@-]*)$/.exec(before)?.[1] ?? "";
  const segments = written.split("/").filter((segment) => segment !== "");
  const directory = segments[segments.length - 1] ?? "";
  if (directory === "") return RULESET_DIRECTORIES[0].names().includes(named);
  if (directory === "__fixtures__") return RULESET_DIRECTORIES[1].names().includes(named);
  if (directory === "rules") return RULESET_DIRECTORIES[0].names().includes(named);
  // Neither directory holds rulesets, so nothing this points at can be there.
  return false;
}

// Ruleset artifacts named inside a STRING, which is the only place a name is load-bearing.
//
// CODE ONLY. COMMENTS ARE OUT OF SCOPE, DELIBERATELY AND AFTER CONSIDERING THE ALTERNATIVE — said
// here so the next person knows it was decided rather than missed, because a stale comment naming
// a deleted artifact is a real defect and a reader is entitled to ask why this does not catch it.
//
// The case for scanning prose is that stale documentation is the same dangling-reference class the
// repo hit three times in one night. The case against, which won:
//
//   1. A comment cannot break a build. This check was built for a path that is READ, and the break
//      it exists to prevent was an import-time `readFileSync` of a file a publication had deleted.
//      Prose has no such failure mode, so including it widens the rule past its evidence.
//   2. The comments it would flag are CORRECT AND USEFUL. The most valuable ones are precisely the
//      ones that name an old path in order to explain why the code no longer does — this file's own
//      `withoutComments` note, and the migration away from hard-coded paths, both do exactly that.
//      A check that flags the record of a fix punishes the fix.
//   3. A check that flags prose accumulates exemptions until someone switches it off. Three false
//      positives were already designed out of this rule to keep it credible; adding a category that
//      generates them by design would undo that.
//
// So the file is PARSED, by the TypeScript compiler already in devDependencies, and only string
// literals, no-substitution templates and template spans are scanned. Comments are trivia and are
// never visited, which is the same deliberate boundary as before but reached by construction rather
// than by blanking text and hoping the blanking agreed with the scanner. Stated both ways, as
// before: `const p = "rules/nyc-rules.v1.json"` fails, and the same text in a comment does not.
//
// WHAT THE PARSER GUARANTEES, precisely, because the previous scanner's guarantee was "these four
// reported shapes now work" and that is what kept breaking. Node positions come from the same
// grammar the runtime uses, so every place a hand-rolled scanner had to guess is decided instead:
// a regex literal is a RegularExpressionLiteral and its contents are not string contents; JSX text
// is JsxText and an apostrophe in it opens nothing; a template literal's spans are separate nodes
// whatever they nest; an escape is the parser's problem. There is no longer a class of "the
// scanner lost sync" bug to test for, because there is no scanner state to lose.
//
// A parse failure is a HARD failure, not a skip. A file this check cannot read is a file it cannot
// vouch for, and silently passing it is the exact shape of miss the check exists to prevent. All
// 106 source files in the repo parse clean today, so this costs nothing until it is real.
//
// WHAT THESE TWO RULES DO NOT COVER, kept current rather than written once and left to rot:
//
//   • Prose in code naming a superseded artifact goes stale silently. Deliberate, per the three
//     reasons above. In a documentation lint, not here.
//   • A path assembled by CONCATENATION — `"rules/nyc-rules.v" + version + ".json"` — is invisible,
//     and parsing does NOT close it. Each operand is its own literal node and none of them contains
//     a ruleset name, so the parser sees exactly what the old scanner saw. Closing it needs the
//     VALUE of an expression, which is constant folding, not parsing, and that is deliberately out
//     of scope: it would mean evaluating imported constants to be sound. This file's own test suite
//     relies on the gap to name fixtures it does not want flagged, which is honest about the cost.
//   • A path whose directory is not written beside the name, because the directory is read from the
//     text around it. `join(someDir, name)` is held to `rules/`, which is the right default here and
//     is still a default.
//   • AN ESCAPE THAT HIDES THE `nyc-rules.` PREFIX ITSELF, which is the concatenation gap wearing a
//     different hat and is named separately because a reader will not otherwise connect the two.
//     `RULES_FILE="rules/nyc\x2drules.v2.8.json"` in a `.env` is a real, absent path — `--env-file`
//     keeps the backslash — but no token is spelled anywhere in the value, so a scanner that looks
//     for names has nothing to look at. Round 13 stopped this being WORSE than a gap: the old
//     decoder resolved `\x2d` as though it were YAML, produced a name that exists, and had the
//     check vouch for the path. It says nothing about it now, which is the honest answer, but it
//     still does not catch it. Same shape in a `String.raw` template.
//   • Compose v2's default filenames, `compose.yaml` and `compose.yml`, which drop the `docker-`
//     prefix `CONFIGURES_RULES_FILE` requires. No compose file exists here, so this is prospective
//     rather than live — but it is a silent miss in the config rule's OWN file set, which is the
//     class this whole check exists for, so it is named rather than left to be rediscovered.
//   • The reverse risk in the same rule: config files are scanned whole, comments included, so
//     prose in one that reads "the nyc-rules. file" yields the token `nyc-rules`, which is in no
//     published set, and CI goes red on a sentence. Also prospective, and worth naming because
//     `apps/api/.env.example` now carries several lines of explanatory prose that this rule reads.
//
// Covered as of this round and not before: the `RULES_FILE` override in `.env`, compose and
// workflow files, which is where the only live stale reference in the repo actually was.
// The WHOLE filename token, compared exactly against what exists, rather than a prefix ending in
// `.json`. A pattern that stopped at `.json` matched a prefix of `nyc-rules.v2.8.json.bak` and of
// `nyc-rules.v2.8.jsonx`, found the prefix in the published set, and passed — accepting a reference
// to a file that is not there. Taking the whole run and requiring an exact match closes both, and
// requires the name to end at `.json` as a consequence rather than as a second rule: the set holds
// only `.json` names.
//
// TRAILING PUNCTUATION IS NOT TRIMMED, in either rule, and that is a decided trade rather than an
// oversight. Trimming was added so a filename ending an English sentence would not be misread, and
// it also silently accepted `nyc-rules.v2.8.json-` and `nyc-rules.v2.8.json.`, which are path typos
// naming files that are not there. The two errors are not equal: a false positive on prose is loud
// and fixed in a minute, an accepted typo is silent and breaks at runtime, and the second is the
// class this check exists for. So the token is compared as written.
//
// The cost, stated: a string or a config line whose prose ends with the filename and a full stop
// fails. Nothing in the repo does that today. If it becomes a nuisance the answer is to narrow what
// is scanned, not to go back to accepting typos quietly.
//
// THE RUN HAS TO RUN FAR ENOUGH FOR ANY OF THAT TO HOLD, which is what `[\w.-]*` did not do. It
// stopped at the first character outside word/dot/hyphen, so `rules/nyc-rules.v2.8.json?backup`
// yielded the published name, matched it exactly, and passed — while `readFileSync` opens the whole
// token and gets ENOENT. Same family as `.bak` and `.jsonx` above: a prefix of a bad name is a good
// name. Taking the whole run is only a fix if the run ends where the FILENAME ends, and `?`, `#`,
// `%`, `:` and the rest of that set are legal in one.
//
// So the class is stated as what a filename cannot contain, not as a shortlist of what it can — and
// there are TWO of them, because the two rules read two different kinds of text and the answer is
// genuinely different. Keeping one set for both is what this round is fixing, so the split is
// written out rather than left to be inferred:
//
// ══ THE RULE, because this has now been settled in one scanner and left wrong in another THREE
// TIMES: rounds 9 and 11 moved the JavaScript rule onto values while the package-script rule and
// the config rule went on reading bytes.
//
//   EVERY SCANNER JUDGES THE VALUE A RUNTIME WOULD SEE, AND THE TOKENIZER FOLLOWS THE VALUE
//   RATHER THAN THE FILE TYPE.
//
// THAT WAS HALF THE RULE, and round 13 is the other half. Round 12 moved every scanner onto decoded
// values and then applied ONE decoder to all of them, as though "decoded" were a single state. It
// is not. Three formats reach this file and no two share their escape or quoting rules, so:
//
//   A VALUE IS DECODED BY THE SEMANTICS OF THE FORMAT IT CAME FROM, AND THE TOKENIZER FOLLOWS THE
//   VALUE'S ORIGIN RATHER THAN THE FACT THAT IT HAS BEEN DECODED AT ALL.
//
// What that costs to get wrong, one per format, all three observed rather than reasoned about:
//
//   • A JS literal is decoded by the PARSER, which also tells us exactly where the string ends.
//     Treating whitespace as a delimiter afterwards discards that: `readFileSync("rules/
//     nyc-rules.v2.8.json ")` validated on the name before the space while the runtime opened the
//     one with it.
//   • A package script is decoded by `JSON.parse` into SHELL SOURCE, not into a filename. Quoting
//     is still ahead of it: `cat 'rules/nyc-rules.v2.8.json'` had its closing quote eaten into the
//     name and was reported missing, a false positive on a valid command.
//   • A `.env` value is decoded by `--env-file`, which is NOT YAML and shares almost none of its
//     escapes. Decoding `\x2d` there invents a name the loader never produces.
//
// So the tokenizer choice is not "raw or decoded". It is WHETHER THE EXTENT IS KNOWN:
//
// WHEN THE EXTENT IS KNOWN — a parsed JS literal, a shell word, a quoted scalar — something has
// already told us where the value ends, so nothing needs to guess and ONLY THE SEPARATOR ends the
// token. The value IS the path; every character except `/` is legal in a filename; and `/` is
// excluded only because the directory is read separately by `resolves`. One boundary, for all four,
// for the same reason.
//
// THE NEWLINE WAS EXCLUDED HERE FOR ONE ROUND AND THAT WAS WRONG, recorded because the reasoning
// failed in a way this file has warned about since round 9. The claim was that a newline cannot be
// inside a single-line value. It can, in every format here: a JS literal decodes `\n` to a real
// newline in its cooked value, and `--env-file` does the same. Verified rather than assumed —
// `RULES_FILE="rules/nyc-rules.v2.8.json\nbackup"` is ONE value of 32 characters containing a
// newline, with `backup` retained after it. So `readFileSync("rules/nyc-rules.v2.8.json\nbackup")`
// and that override both name absent paths, and the exclusion validated the published prefix of
// each.
//
// WHY IT WENT IN: to kill a false positive where a multi-line template mentioning the artifact in
// prose reported its whole remainder. That is closing a false positive BY NARROWING THE TOKEN,
// which is the move this file has refused since round 9, applied to its own code without noticing
// it was that move. The space cost was already accepted on the loud-versus-silent principle; the
// newline cost is the same cost and is accepted on the same grounds.
//
// A PER-FORMAT BOUNDARY WAS CONSIDERED AND REJECTED, as two rules where one is true. Per-format is
// right for the DECODER and for the QUOTING, because the formats genuinely differ there. They do
// not differ about what a filename may contain.
//
// WHEN THE EXTENT IS NOT KNOWN — unquoted config text, read whole — a boundary has to be guessed,
// so whitespace ends the token and the quote characters and braces still delimit, because in that
// text they genuinely do.
//
// The cost of the first, stated: a string whose prose names the published artifact and then keeps
// going, `"rules/nyc-rules.v2.8.json is the current one"`, reports the whole run, and a multi-line
// template does the same across its lines. That is loud and fixed in a minute, and this file has
// traded that way since round 8 on the grounds that an accepted typo is silent and breaks at
// runtime. Nothing in the repo pays it today.
//
// WHY THIS WAS ONE SET AND WHY THAT WAS WRONG. Round 9 unified the JS rule on cooked values and
// kept the raw-oriented class that had served the old raw scan. The exclusions were then describing
// text the rule no longer read: `rules/nyc-rules.v2.8.json{backup` and the same with a quote
// truncated to the published prefix, matched exactly, and passed, while the runtime opens the whole
// token and gets ENOENT. That is the `.bak` and `?backup` family again, arriving by a route the
// earlier fixes did not cover.
//
// `\` LEFT THE COOKED SET IN ROUND 9 for exactly this reason, one character early. It was excluded
// as an escape lead-in, a hazard that only exists in raw source text, and truncating there reported
// `nyc-rules.v2.8` for a path that is nothing of the sort. The reasoning was right and stopped at
// the character that had been reported; the rest of the class needed the same treatment.
const RULESET_FILENAME_IN_VALUE = /nyc-rules\.[^/]*/g;
const RULESET_FILENAME_IN_TEXT = /nyc-rules\.[^\s/'"`{}]*/g;

/**
 * How a double-quoted scalar decodes, PER FORMAT, because the two formats this reads are not
 * remotely the same and round 12 gave them one decoder.
 *
 * YAML 1.2 §5.7 defines the full C-style set for a double-quoted scalar, so `\x2d`, `-`, `\n`,
 * `\t` and `\\` all resolve. This is a subset of that, covering what a ruleset path can hide behind
 * rather than the whole grammar, and anything unrecognised is left exactly as written — a wrong
 * guess would invent a filename rather than find one. Stated as spec rather than observation: this
 * repo has no YAML loader to interrogate, and GitHub's is not on this machine.
 *
 * DOTENV IS NOT YAML, and this is the one place the difference is load-bearing. Observed directly
 * on Node v24.18.0 with `--env-file`, because guessing at another tool's behaviour is how the
 * previous decoder got here:
 *
 *     A="rules/nyc\x2drules.v2.8.json"   ->   rules/nyc\x2drules.v2.8.json   (backslash kept)
 *     DQ_N="a\nb"                        ->   a<newline>b                    (the ONLY escape)
 *     DQ_T="a\tb"  DQ_U="a-b"       ->   backslash kept, both
 *     DQ_BS="a\\b"                       ->   a\\b       (NOT collapsed to one)
 *     DQ_Q="a\"b"                        ->   a\         (`\"` does not escape; the quote ends it)
 *     'a\nb'  `a\nb`  a\nb               ->   literal, nothing decoded
 *
 * So `--env-file` honours exactly one escape, `\n`, and only inside double quotes. Decoding `\x2d`
 * there produced `rules/nyc-rules.v2.8.json`, a file that exists, and the check then VOUCHED for an
 * override that actually names a path with a backslash in it. Not merely a miss: an endorsement.
 */
const decodeYamlEscapes = (value) =>
  value.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (whole, escape) => {
    if (escape[0] === "x" || escape[0] === "u")
      return String.fromCharCode(parseInt(escape.slice(1), 16));
    const simple = { n: "\n", t: "\t", r: "\r", 0: "\0", "\\": "\\", '"': '"', "/": "/" };
    return simple[escape] ?? whole;
  });

/** `--env-file` honours `\n` in a double-quoted value and nothing else. Observed, see above. */
const decodeDotenvEscapes = (value) => value.replace(/\\n/g, "\n");

/**
 * Which quoting characters open a scalar, and how its contents decode, for one config format.
 *
 * `--env-file` accepts backticks as a third quote character; YAML does not, and treating one as a
 * quote in YAML would silently swallow text between two unrelated backticks in a comment.
 */
/**
 * Where a config file's VALUES are: `[{ index, length, value }]`, decoded, in file order.
 *
 * A segmenter per format rather than a regex per format, because round 15 is where the regex ran
 * out. Both formats let a value SPAN LINES, and both segmenters stopped at a newline for the same
 * unexamined reason: a newline usually ends a line. It usually does. In a quoted dotenv value and a
 * YAML block scalar it does not, and in both cases the raw fallback then validated the existing
 * prefix and passed.
 */

/**
 * dotenv values, found from the ASSIGNMENT rather than by hunting quotes.
 *
 * Line structure is what makes multiline safe here. A quote only opens a value directly after
 * `KEY=`, so an apostrophe in a comment cannot open one and swallow the rest of the file, which is
 * exactly what a quote-hunting regex allowed to cross lines would do. Verified on Node v24.18.0,
 * and the finding cites v24.15.0 with the same behaviour:
 *
 *     ML="rules/nyc-rules.v2.8.json<newline>backup"   ->  one value, the newline inside it
 *     SQ='a<newline>b'   BQ=`c<newline>d`             ->  the same, all three quote characters
 *     UQ=e<newline>f                                  ->  "e"; unquoted values stop at the line
 *     OPEN="unterminated<newline>NEXT=sentinel        ->  OPEN is `"unterminated`, NEXT still read
 *
 * That last line is why an unterminated quote is left alone rather than run to the end of the file:
 * Node keeps the quote character in the value and ends it at the line, so the raw pass reading that
 * line as text is the closer description. Same rule as the shell tokenizer, for the same reason.
 */
function dotenvValues(text) {
  const values = [];
  for (const assignment of text.matchAll(/^[ \t]*(?:export[ \t]+)?[\w.]+[ \t]*=[ \t]*/gm)) {
    const at = assignment.index + assignment[0].length;
    const quote = text[at];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;
    const close = text.indexOf(quote, at + 1);
    if (close === -1) continue;
    const content = text.slice(at + 1, close);
    values.push({
      index: at,
      length: close - at + 1,
      value: quote === '"' ? decodeDotenvEscapes(content) : content,
    });
  }
  return values;
}

/**
 * YAML values: quoted scalars, and the BLOCK scalars that were missing.
 *
 * `RULES_FILE: >-` followed by indented lines is one value, folded to spaces; `|` keeps the
 * newlines. Neither was recognised, so the block's lines went to the raw pass a line at a time and
 * the first line validated on its own. Block scalars are not exotic here: `run: |` is in most
 * GitHub workflow files ever written, which is also why failing loudly on them was not an option.
 *
 * The extent is the indentation, which is what YAML says it is: the block runs while lines are
 * blank or indented deeper than the key that introduced it.
 */
function yamlValues(text) {
  const values = [];
  const lines = text.split("\n");
  const offsets = [];
  let running = 0;
  for (const line of lines) {
    offsets.push(running);
    running += line.length + 1;
  }

  const blocked = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = /^([ \t]*)[^\s#][^:\n]*:[ \t]*([|>])([+-]?\d*|\d*[+-]?)[ \t]*(#[^\n]*)?$/.exec(
      lines[index],
    );
    if (header === null) continue;
    const indent = header[1].length;
    const body = [];
    let last = index;
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      const blank = line.trim() === "";
      const deeper = /^[ \t]*/.exec(line)[0].length > indent;
      if (!blank && !deeper) break;
      body.push(line.trim());
      last = next;
    }
    // Trailing blank lines are chomped by every indicator, so they are not part of the value and
    // would otherwise show up as a space on the end of a reported name.
    while (body.length > 0 && body[body.length - 1] === "") body.pop();
    if (body.length === 0) continue;
    const from = offsets[index + 1];
    const to = offsets[last] + lines[last].length;
    // `>` folds line breaks to spaces, `|` keeps them. Either way the value is one string, which is
    // the whole point: a name on one line and a suffix on the next are the same path.
    values.push({
      index: from,
      length: to - from,
      value: body.join(header[2] === ">" ? " " : "\n"),
    });
    blocked.push([from, to]);
    index = last;
  }

  for (const quoted of text.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\n]|'')*)'/g)) {
    if (blocked.some(([from, to]) => quoted.index >= from && quoted.index < to)) continue;
    const double = quoted[1] !== undefined;
    values.push({
      index: quoted.index,
      length: quoted[0].length,
      value: double ? decodeYamlEscapes(quoted[1]) : quoted[2].replace(/''/g, "'"),
    });
  }

  return values.sort((a, b) => a.index - b.index);
}

const CONFIG_FORMATS = {
  // `\"` DOES NOT ESCAPE in a `.env` value, so the scalar really does end at that quote and the
  // backslash stays in the value. Observed, not assumed: `DQ_Q="a\"b"` yields `a\`. Making it
  // escape-aware to match YAML would introduce the very bug being fixed there, in reverse.
  // `--env-file` also accepts backticks as a third quote character, which YAML does not.
  dotenv: { values: dotenvValues },
  // ESCAPE-AWARE, because YAML's double-quoted scalar defines `\"` and a segmenter that stops at
  // the first quote loses to it. A single-quoted YAML scalar escapes a quote by DOUBLING it, `''`,
  // with no backslashes at all, so the two forms need different handling rather than one with a
  // backslash bolted on.
  yaml: { values: yamlValues },
};

/** `.env`, `.env.example` and friends load through `--env-file`; the rest of the set is YAML. */
const configFormat = (relative) => (/(^|\/)\.env(\..+)?$/.test(relative) ? "dotenv" : "yaml");

/**
 * Where `text` has a ruleset name that is not one of the files that exist, and on what line.
 *
 * SEGMENTED, not scanned whole, because a config file is not one kind of text. A quoted scalar is a
 * VALUE: the loader strips its quotes and resolves its escapes before the process sees it, so
 * `RULES_FILE: "rules/nyc\x2drules.v9.9.json"` names a file that does not exist while the bytes on
 * disk never show the `nyc-rules.` prefix at all. Reading the file as raw bytes could not see it.
 * Everything OUTSIDE a quoted scalar really is raw text, where a quote opens a scalar and `{` and
 * `}` bound a flow mapping, so it keeps the text tokenizer.
 *
 * Single quotes are segmented too but NOT decoded, which is what both formats specify: a
 * single-quoted scalar is literal. The quotes still come off, so a brace inside one is an ordinary
 * filename character rather than punctuation.
 *
 * WHICH decoder is the caller's to say, because `.env` and YAML disagree about almost every escape
 * and sharing one is what round 12 got wrong. See `CONFIG_FORMATS`.
 */
function danglingIn(text, format = "yaml") {
  const found = [];
  const { values } = CONFIG_FORMATS[format];
  const lineOf = (index) => text.slice(0, index).split("\n").length;
  // `at` is where the segment starts in the file. A raw segment is the file's own text, so a match
  // inside it keeps its exact offset; a decoded scalar is a different string, so every match in one
  // is reported at the scalar.
  const scan = (segment, pattern, at, exact) => {
    for (const match of segment.matchAll(pattern)) {
      if (!resolves(match[0], segment, match.index)) {
        found.push({ line: lineOf(exact ? at + match.index : at), named: match[0] });
      }
    }
  };

  let plainFrom = 0;
  for (const { index, length, value } of values(text)) {
    scan(text.slice(plainFrom, index), RULESET_FILENAME_IN_TEXT, plainFrom, true);
    // The whole value is one string, so its offset is the value's start, not the decoded token's:
    // an escape or a fold changes the length and a computed column would land somewhere else.
    scan(value, RULESET_FILENAME_IN_VALUE, index, false);
    plainFrom = index + length;
  }
  scan(text.slice(plainFrom), RULESET_FILENAME_IN_TEXT, plainFrom, true);
  return found;
}

/**
 * The same search, confined to the string literals the parser found.
 *
 * FOR AN UNTAGGED LITERAL ONLY THE COOKED VALUE IS JUDGED, and the raw text is used only to locate
 * what the value found. The previous round scanned both and reported from both, which is where the
 * first false positive this check has ever produced came from: `"rules/nyc-rules.v2.8\x2ejson"` is
 * the published artifact, and the raw scan stopped at the backslash, recorded `nyc-rules.v2.8` as a
 * name that does not exist, and could not take it back when the cooked pass then resolved the real
 * one. Two scans producing findings means one of them is looking at something that is not a
 * filename.
 *
 * A TAGGED TEMPLATE INVERTS THAT, and it is the one place in this file where "judge the cooked
 * value" is the wrong answer. `String.raw`rules/nyc-rules.v2.8\x2ejson`` cooks to the published
 * name, which exists, so the check passed — while `String.raw` returns the RAW value and the
 * runtime opens `rules/nyc-rules.v2.8\x2ejson`, which is absent. The tag decides what the value is,
 * and the parser's `.text` is only one candidate for it.
 *
 * So the tag is asked, and there are three answers:
 *
 *   • NO TAG — the cooked value IS the value. Unchanged, and it is almost every literal here.
 *   • A TAG THIS RECOGNISES — `String.raw` is specified to return the raw text, so the raw text is
 *     the value and the cooked text is not judged at all. Judging it too would report the published
 *     artifact as missing whenever an escape happened to cook into it.
 *   • ANY OTHER TAG — the value is UNKNOWN, so neither candidate is treated as authoritative and
 *     BOTH must resolve. A tag is an arbitrary function: `sql`, `html` and `dedent` all return
 *     something this check cannot compute, so picking one candidate would be a guess, and the
 *     direction of the guess is exactly what let this through. Requiring both is the conservative
 *     default because it can only over-report, never miss, and it over-reports only when raw and
 *     cooked DIFFER — which means only when the literal contains an escape. With no escape the two
 *     are identical and this is one judgement, which is the overwhelming majority of tagged
 *     templates.
 *
 * WHAT THIS STILL CANNOT SEE, said rather than left: an alias. `const raw = String.raw` then
 * `` raw`...` `` reads as an unrecognised tag, which is the safe direction (both candidates are
 * held) but not recognition. And a raw value whose escape HIDES the prefix, `` String.raw`rules/
 * nyc\x2drules.v2.8.json` ``, is invisible to a name scanner because the name is not spelled
 * anywhere in it. That is the concatenation gap wearing a different hat: a name nothing spells
 * cannot be found by looking for names.
 *
 * The cooked value is the right one to judge because it is what the string IS at runtime, and the
 * runtime is what opens the file: the parser reads `"rules/nyc\x2drules.v9.9.json"` as
 * `rules/nyc-rules.v9.9.json`, which names a file that is not there while matching nothing a text
 * search can see. Nothing is lost by dropping the raw pass, because a name visible in the source
 * but not in the value is not a name anything ever opens.
 *
 * WHAT THE RAW TEXT IS STILL FOR: the reported line. An unescaped literal is its delimiters plus
 * its value, so the value appears verbatim in the source and the offset maps exactly, which is how
 * a name inside a multi-line template still lands on its own line. An escape changes the length,
 * the value stops being a substring of the source, and the literal's own line is then the honest
 * answer rather than a computed one that would point at the wrong column.
 *
 * A FRAGMENT IS NOT A NAME. A TemplateHead's or TemplateMiddle's value is continued by the span
 * that follows it, so a token running to the end of one is an unfinished path and not a missing
 * file: `` `rules/nyc-rules.v${version}.json` `` was reported as naming `nyc-rules.v`, which is
 * ordinary dynamic selection failing CI. Such a token is skipped. Note the shape of the rule, which
 * is narrow on purpose: only a token that ENDS at the boundary is spared, so a complete name
 * earlier in the same head is still reported.
 *
 * The cost of that, stated rather than left to be discovered: a dangling name written immediately
 * before an interpolation, `` `rules/nyc-rules.v9.9.json${suffix}` ``, is not reported. It cannot
 * honestly be, since the path is the name plus whatever the span evaluates to and this check does
 * not evaluate expressions. That is the documented concatenation gap in template form rather than
 * a new one; the previous behaviour looked like coverage only because a fragment happened to be
 * spelled like a whole name.
 */
function danglingInLiterals(sourceFile, literals) {
  const found = [];
  for (const literal of literals) {
    for (const value of literal.values) {
      // Where this candidate sits in the source, when it sits there at all. A candidate that
      // appears verbatim gets an exact offset; one the parser rewrote is reported at its literal.
      const valueAt = literal.raw.indexOf(value);
      for (const token of value.matchAll(RULESET_FILENAME_IN_VALUE)) {
        if (resolves(token[0], value, token.index)) continue;
        if (literal.continues && token.index + token[0].length === value.length) continue;
        const at = valueAt === -1 ? literal.index : literal.index + valueAt + token.index;
        found.push({
          line: sourceFile.getLineAndCharacterOfPosition(at).line + 1,
          named: token[0],
        });
      }
    }
  }
  return found;
}

/**
 * The one exemption, and the only one: a line in a TEST file that declares its ruleset names are
 * fixtures rather than paths.
 *
 * NOTHING IN THE REPO CLAIMS IT ANY MORE, and that is the outcome of the round it nearly broke.
 * `apps/web/app/rules-file.test.ts` built fixture names for a temp directory it creates, marked
 * three lines of them, and left twelve more unmarked. Those twelve passed only because the version
 * they spelled happened to still be on disk: publishing v2.9 and deleting v2.8 turns every one into
 * a dangling reference, so the guard written to make a bump safe would have failed the bump, loudly,
 * on a file that is correct. Verified against that tree rather than argued.
 *
 * The line pair was the wrong unit and marking the other twelve was the wrong fix — it works until
 * someone writes a thirteenth. That file now assembles its names from a version this repo will never
 * publish, so it needs no exemption at all and nothing in it needs editing when a version ships.
 * `A BUMP DOES NOT BREAK THE GUARD` in the suite plants a v2.9-only tree, drops the REAL file into
 * it and asserts a pass, so the next publication finds out here rather than during the release.
 *
 * THE MECHANISM STAYS, for a test that genuinely needs a name that does not exist rather than one
 * that merely needs A name. That distinction is the whole of when to reach for this: if any valid
 * name would do, build one and do not mark anything.
 *
 * WHY A MARKER RATHER THAN A RULE. The tempting rule is "a literal that is exactly a filename is
 * not a path", which is elegant, needs no marker, and is wrong about a file that is not in front of
 * us: `const RULES = "nyc-rules.v2.8.json"` joined to a directory elsewhere is ordinary production
 * code, and a check built to catch hardcoded ruleset paths must not be structurally blind to a
 * class of production reference. The marker gives up elegance to keep that coverage.
 *
 * WHAT IT DOES NOT COVER, said plainly because an exemption that hides its cost is worse than no
 * exemption:
 *
 *   1. IT CAN BE SPRINKLED, inside a test file. Nothing here can tell a fictional fixture name from
 *      a genuinely dangling path that someone would rather not fix, so a test that reads the REAL
 *      `rules/` directory by literal name and marks the line goes unguarded by this check. The
 *      marker is greppable and shows up in a diff, which is the whole of its defence.
 *   2. IT IS NOT AVAILABLE TO PRODUCTION CODE, which is the half that matters, and which the
 *      predicate below now actually delivers. `apps/web/app/checklist/checklist-fixtures.ts` is a
 *      fixture BUILDER and not a test file, so the PR #138 break — that file hardcoding
 *      `rules/nyc-rules.v2.7.json` — is still caught today. Claiming the exemption there means
 *      renaming the file into one VITEST RUNS, which changes what the suite executes and what
 *      coverage measures, so it cannot be done quietly.
 *
 * THAT SENTENCE WAS AN ARGUMENT BEFORE IT WAS A FACT, and this design was chosen over a
 * directory-shaped alternative on the strength of it, so it is worth being exact about the gap. The
 * predicate was `.test.` ANYWHERE IN THE BASENAME, which is broader than the set vitest discovers
 * in two independent ways. `apps/web/app/reader.test.helper.ts` contains `.test.` and ends in
 * `.helper.ts`, so vitest never runs it and it imports like any other module; `tools/reader.test.ts`
 * has the right suffix in a tree no include pattern covers. Both claimed the exemption, both
 * suppressed a genuinely absent path, and both are ordinary production code. The escape hatch was
 * reachable from exactly where it was advertised as unreachable.
 *
 * So the predicate is now vitest's own include globs rather than a paraphrase of them. A file may
 * claim the exemption only if vitest would collect it, which is what makes the rename real: a file
 * that claims this and is not run does not exist.
 */
const FIXTURE_NAMES_MARKER = "baseline-check: fixture ruleset names";

/**
 * A COPY of `vitest.config.ts`'s `include`, and the copy is deliberate for the same reason
 * `PUBLISHED_RULESET` is one.
 *
 * Reading the real config would remove the duplication and would also make this check unable to run
 * against a tree that does not contain a vitest config — and every test in this file's suite works
 * by planting a minimal tree and pointing the real script at it. That is precisely what was tried
 * with `apps/api/src/ruleset.ts` in round 7 and reverted after twenty-seven of thirty-one tests
 * went red. `vitestIncludeMatches` in the suite is what stops this drifting: it reads the real
 * config's include array and fails if it is not this list.
 */
const VITEST_INCLUDE = [
  "{apps,packages}/*/src/**/*.test.{ts,tsx}",
  "apps/web/app/**/*.test.{ts,tsx}",
  "scripts/**/*.test.mjs",
];

/**
 * One include glob as a regular expression, supporting exactly the three constructs vitest's
 * patterns use here: `{a,b}` alternation, `**` across directories, and `*` within a segment.
 *
 * Written out rather than pulled in, because the alternative is a glob dependency in a script whose
 * entire job is to be trustworthy, and these three constructs are the whole of what the config uses.
 * A pattern using anything else fails the divergence test in the suite rather than being silently
 * mismatched here.
 */
function globToRegExp(glob) {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "{") {
      const close = glob.indexOf("}", index);
      pattern += `(?:${glob
        .slice(index + 1, close)
        .split(",")
        .map((option) => option.replace(/[.+^$()|[\]\\]/g, "\\$&"))
        .join("|")})`;
      index = close;
    } else if (character === "*" && glob[index + 1] === "*") {
      // `**/` spans any number of directories, none included, so `a/**/b.ts` matches `a/b.ts`.
      pattern += glob[index + 2] === "/" ? "(?:[^/]+/)*" : ".*";
      index += glob[index + 2] === "/" ? 2 : 1;
    } else if (character === "*") {
      pattern += "[^/]*";
    } else {
      pattern += character.replace(/[.+^$()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${pattern}$`);
}

const VITEST_COLLECTS = VITEST_INCLUDE.map(globToRegExp);

/** Whether `file` may claim the exemption at all, and whether `line` claims it. */
function claimsFixtureExemption(relative, sourceLines, line) {
  if (!VITEST_COLLECTS.some((pattern) => pattern.test(relative))) return false;
  const own = sourceLines[line - 1] ?? "";
  const above = sourceLines[line - 2] ?? "";
  return own.includes(FIXTURE_NAMES_MARKER) || above.includes(FIXTURE_NAMES_MARKER);
}

/**
 * Files that can set `RULES_FILE`, which is the override the resolver reads before its default.
 *
 * Scanned because the override is the one place a hardcoded version is invisible to the rule above:
 * the mechanism built to point the resolver elsewhere was the mechanism no check could see through.
 * `apps/api/.env.example` named `nyc-rules.v2.5.json` for three publications, and its own first line
 * says "copy to .env for local dev" — so the documented way to run the api locally was to point it
 * at a file deleted long ago.
 *
 * These are not JavaScript, and the JS rule's machinery is deliberately not stretched over them: a
 * `KEY=value` line is not a string literal, and `#` is the comment marker in all three formats. So
 * this is a second, narrower rule — every ruleset name anywhere in the file must exist.
 *
 * COMMENTS ARE SCANNED HERE, and that is the opposite of the JS rule on purpose. In code a comment
 * is prose about the code; in a `.env` template a commented-out line is configuration waiting to be
 * uncommented, which is exactly the thing that goes stale and then bites whoever enables it.
 */
const CONFIGURES_RULES_FILE =
  /(^|\/)(\.env(\..+)?|docker-compose.*\.ya?ml)$|^\.github\/workflows\/.+\.ya?ml$/;

/**
 * Workspace manifests, whose `scripts` are executable entry points and were not being read.
 *
 * A package script is a command CI and developers actually run — the CI workflow invokes several
 * root scripts by name — so `"seed": "node seed.mjs rules/nyc-rules.v2.8.json"` is a path that
 * breaks on a publication exactly like the `.env` override did, and for the same reason it was
 * invisible: it is not JavaScript source and it is not a config format this check knew about. This
 * is a new file CATEGORY in the sense `.env`, compose and workflow files were, not a new rule.
 *
 * ONLY THE `scripts` FIELD, and only in manifests. Scanning JSON generally would be actively wrong
 * here: the ruleset artifacts ARE JSON and are full of ruleset names by definition, as are the
 * replay fixtures, so a blanket JSON rule would report the published artifact as a dangling
 * reference to itself. The narrow field is the whole point — it is the part of a manifest that gets
 * executed.
 *
 * A manifest that will not parse is a HARD failure, for the same reason an unparseable source file
 * is: a file this check cannot read is a file it cannot vouch for.
 */
const WORKSPACE_MANIFEST = /^(package\.json|(apps|packages)\/[^/]+\/package\.json)$/;

/**
 * A shell command split into the words the shell would pass along, with its quoting removed.
 *
 * `JSON.parse` decodes a script into SHELL SOURCE, not into a filename, and round 12 treated the
 * two as the same thing. One decode had happened, so the string was called a value and handed
 * straight to the value tokenizer — but a layer of quoting was still in front of it, and
 * `cat 'rules/nyc-rules.v2.8.json'` had its closing quote eaten into the name and was reported
 * missing. A false positive on a command that runs perfectly.
 *
 * Not a shell. It implements the three quoting forms POSIX defines and nothing else, because that
 * is all that stands between a script and the path it names:
 *
 *   • `'...'` is literal, with no escapes at all, not even for a backslash;
 *   • `"..."` keeps most characters literal but honours `\` before `"`, `\`, `` ` `` and `$`;
 *   • outside quotes, `\` escapes the next character, and unquoted whitespace separates words;
 *   • outside quotes, a CONTROL OR REDIRECTION OPERATOR separates them too, with or without the
 *     whitespace: `;`, `&`, `|`, `<`, `>`, `(` and `)`;
 *   • a BACKQUOTE delimits command substitution anywhere a single quote has not made it literal,
 *     so it separates words too.
 *
 * The backquote is round 15 and closes the older of the two substitution spellings.
 * ``cat `printf rules/nyc-rules.v2.8.json` `` is ordinary Bash and was rejected, because the
 * tokenizer knew two quote characters and not the third thing a shell does with them. The modern
 * `$(...)` spelling already worked, and worked by accident rather than by design: `(` and `)` are
 * in the operator set above, so the substitution fell apart into words on its own. Both are covered
 * now, one deliberately, and a tokenizer that knew one spelling and not the other was a finding
 * waiting to be filed.
 *
 * That last line is round 14, and it is the same defect as the quoting one it sits under. Splitting
 * on whitespace ALONE meant `cat rules/nyc-rules.v2.8.json; echo ok` handed the matcher a filename
 * with a semicolon welded on, and the check reported the PUBLISHED, EXISTING artifact as missing.
 * A guard failing `pnpm check:baseline` on a correct script is the version-bump blocker from round
 * 11 wearing different clothes: whoever it blocks switches it off, and the class it exists to catch
 * comes back with the guard disabled. The multi-character operators need no special handling here,
 * because `&&`, `||` and `>>` are runs of these same characters and word splitting is all this is
 * for.
 *
 * Expansion is NOT attempted and must not be: `$RULES` and `$(cat x)` are values this check cannot
 * compute, exactly like a concatenated path in JavaScript. The word keeps the text as written and
 * is judged as a name, which either resolves or is reported — never guessed at.
 *
 * AN UNTERMINATED QUOTE OR BACKQUOTE RETURNS null rather than a best guess. The command is not
 * valid shell and would not run, so there are no words to speak of; dropping the stray delimiter
 * would invent a value the shell never produces, and inventing values is the whole family of defect
 * these rounds are about. The caller judges the command as written instead, which is the
 * conservative reading and is what catches a delimiter appended to a published name. The backquote
 * is held to the same rule as the quotes for the same reason, so
 * `node seed.mjs rules/nyc-rules.v2.8.json\`backup` is still reported whole.
 */
const SHELL_OPERATORS = new Set([";", "&", "|", "<", ">", "(", ")"]);

function shellWords(command) {
  const words = [];
  let word = null;
  let quote = null;
  let backquoted = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    // A backquote is literal ONLY inside single quotes, which is why this is not in the operator
    // set: the set is consulted for unquoted text alone, and a backquote still opens a substitution
    // inside a double-quoted string.
    const substitutes = character === "`" && quote !== "'";
    if (substitutes) backquoted = !backquoted;
    if (
      substitutes ||
      (quote === null && (/\s/.test(character) || SHELL_OPERATORS.has(character)))
    ) {
      if (word !== null) words.push(word);
      word = null;
      continue;
    }
    if (word === null) word = "";
    if (quote === null && (character === "'" || character === '"')) {
      quote = character;
    } else if (quote === character) {
      quote = null;
    } else if (character === "\\" && quote !== "'") {
      // Inside double quotes a backslash is literal unless it precedes one of the four characters
      // the shell still treats as special there; outside quotes it always escapes.
      const next = command[index + 1];
      const special = quote === '"' ? ['"', "\\", "`", "$"].includes(next) : next !== undefined;
      word += special ? next : character;
      if (special) index += 1;
    } else {
      word += character;
    }
  }
  if (quote !== null || backquoted) return null;
  if (word !== null) words.push(word);
  return words;
}

/** Where a manifest's `scripts` name a ruleset that is not there, and on what line. */
function danglingInScripts(relative, text) {
  const found = [];
  let scripts;
  try {
    scripts = JSON.parse(text).scripts;
  } catch (error) {
    console.error(
      `${relative} could not be parsed, so its scripts were not scanned: ${error.message}` +
        "\n\nA file this check cannot read is a file this check cannot vouch for.",
    );
    process.exit(1);
  }
  if (typeof scripts !== "object" || scripts === null) return found;
  const lines = text.split(/\r?\n/);
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== "string") continue;
    // ONE WORD AT A TIME, with the shell's quoting taken off first. `JSON.parse` decoded this into
    // shell source, not into a filename, so the value tokenizer alone was one layer too early: it
    // read the closing quote of `cat 'rules/nyc-rules.v2.8.json'` as part of the name. A word has a
    // known extent, so `{`, `}`, a quote and a space are all ordinary filename characters inside it.
    for (const word of shellWords(command) ?? [command]) {
      for (const match of word.matchAll(RULESET_FILENAME_IN_VALUE)) {
        if (resolves(match[0], word, match.index)) continue;
        // The command is one string with no line structure of its own, so the line reported is the
        // manifest line the script is declared on, which is what a reader needs to go and fix it.
        const declaredOn = lines.findIndex((line) => line.includes(`"${name}"`));
        found.push({ line: declaredOn === -1 ? 1 : declaredOn + 1, named: match[0] });
      }
    }
  }
  return found;
}

/**
 * The string literals a JavaScript or TypeScript source contains, found by PARSING it.
 *
 * This replaces a hand-rolled scanner, and the reason is worth recording rather than the change
 * being read as taste. The script lexed by hand in three places, then in one place after those were
 * consolidated, and each version produced a fresh list of findings: escape parity, escaped
 * delimiters, a pin read out of a comment, then nested template literals, a regex after `return`,
 * and an apostrophe in JSX text read as a string. Nested templates, regex-versus-division after a
 * keyword, and JSX are not edge cases to patch. They are the reason parsers exist.
 *
 * `typescript` is already a devDependency, so this adds no package and no supply-chain surface.
 * What the parser settles, by construction rather than by rule:
 *
 *   • a nested template inside `${...}` is its own literal node, so a path in one is seen;
 *   • a regular expression is a `RegularExpressionLiteral` wherever it appears, `return /'/` too;
 *   • JSX text is `JsxText` and is not a literal, so an apostrophe in markup means nothing here;
 *   • a comment is trivia and never a node, so the deliberate rule that a ruleset name in a comment
 *     passes now holds because comments are not in the tree at all, rather than because a blanking
 *     pass was correct.
 *
 * RAW source text is read rather than the parser's cooked `.text`, because an escape changes the
 * offsets and the reported line has to be the one the name is actually on. Ruleset names contain no
 * escapes, so raw and cooked agree on the name itself.
 */
// One entry per `CODE_EXTENSIONS` member. `.mts` and `.cts` are TypeScript with a module-format
// suffix rather than a different language, so they parse as TS; the JS family parses as JS. The
// fallback below still exists, but nothing in `CODE_EXTENSIONS` should be reaching it.
const SCRIPT_KINDS = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
};

/**
 * The tag applied to a template literal part, or null if there is none.
 *
 * Walks only the template's own structure — quasi to span to expression to tag — so a plain string
 * literal sitting INSIDE an interpolation is not mistaken for part of the template. `` tag`${
 * "rules/x.json" }` `` contains an ordinary cooked string, and it is the tag's argument rather than
 * its template text.
 */
function templateTag(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return ts.isTaggedTemplateExpression(node.parent) ? node.parent.tag : null;
  }
  const template =
    node.kind === ts.SyntaxKind.TemplateHead
      ? node.parent
      : ts.isTemplateSpan(node.parent)
        ? node.parent.parent
        : undefined;
  if (template === undefined || !ts.isTemplateExpression(template)) return null;
  return ts.isTaggedTemplateExpression(template.parent) ? template.parent.tag : null;
}

/** `String.raw`, the one tag whose return value this check can compute. */
const returnsRawText = (tag) =>
  ts.isPropertyAccessExpression(tag) &&
  ts.isIdentifier(tag.expression) &&
  tag.expression.text === "String" &&
  tag.name.text === "raw";

/**
 * Every candidate for what a literal is at runtime. One entry when that is knowable, two when the
 * tag makes it a guess. See `danglingInLiterals` for why an unrecognised tag holds both.
 */
function runtimeValues(node) {
  const tag = ts.isStringLiteral(node) ? null : templateTag(node);
  if (tag === null) return [node.text];
  const raw = node.rawText ?? node.text;
  if (returnsRawText(tag)) return [raw];
  return raw === node.text ? [node.text] : [node.text, raw];
}

function parseSource(relative, source) {
  const extension = relative.slice(relative.lastIndexOf("."));
  const sourceFile = ts.createSourceFile(
    relative,
    source,
    ts.ScriptTarget.Latest,
    true,
    SCRIPT_KINDS[extension] ?? ts.ScriptKind.JS,
  );
  const literals = [];
  const visit = (node) => {
    const isLiteral =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail;
    if (isLiteral) {
      const start = node.getStart(sourceFile);
      // `values` is every candidate for what this literal IS at runtime, and judging candidates
      // rather than one form is what the tag forced. Untagged, the parser's cooked text is the
      // value and the only candidate: it reads `"rules/nyc\\x2drules.v9.9.json"` as
      // `rules/nyc-rules.v9.9.json`, a file that is not there and that matches nothing in the raw
      // text. `raw` and `index` are kept to locate a finding, not to make one.
      //
      // `continues` marks the two spans a template interpolation is appended to. Their values are
      // fragments by construction, so a name running to the end of one is unfinished rather than
      // missing, and reporting it blocks ordinary dynamic selection.
      literals.push({
        raw: source.slice(start, node.end),
        values: runtimeValues(node),
        index: start,
        continues:
          node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { sourceFile, literals };
}

/**
 * The version the api pins, read as a MODULE-SCOPE declaration.
 *
 * THIS IS THE THIRD FIX TO THIS LOOKUP and the first two moved the target rather than closing it,
 * so it is worth being exact about what changed. A regex over file text found
 * `EXPECTED_RULESET_VERSION = "…"` inside a comment; stripping comments moved it to any string
 * that happened to contain the assignment; parsing moved it to any DECLARATION, which is closer but
 * still accepts one nested inside a function or a block, where it shadows nothing the module uses.
 * A nested `const EXPECTED_RULESET_VERSION = "nyc.v2.9"` in a test helper would be read as the pin
 * while `validateRuleset` went on comparing against a stale module-scope constant, and the check
 * would confirm the wrong one against the artifact.
 *
 * Each earlier attempt narrowed WHERE IN THE TEXT to look. This one narrows the tree position:
 * declaration inside a declaration list inside a statement whose parent is the file itself. That
 * is a structural fact about the program rather than a guess about its formatting, which is why it
 * is not the same kind of fix as the two before it.
 *
 * WHAT IS AND IS NOT CLAIMED, and the claim is deliberately smaller than the two before it made.
 * This reads the same binding the api's module-level `validateRuleset` resolves, and `const`
 * forbids reassignment, so the value checked against the artifact is the value that code compares.
 * THE `const` IS REQUIRED HERE RATHER THAN ASSUMED, because the sentence before this one is the
 * whole argument and it is only true if the declaration is checked: a module-scope
 * `let EXPECTED_RULESET_VERSION = "nyc.v2.8"` reassigned lower down would satisfy a shape test,
 * confirm the initial value against the artifact, and leave `validateRuleset` comparing the
 * reassigned one. A non-const declaration is rejected outright, which reads as "no pin" and says so.
 * That is the whole claim. It is NOT "final": the gap that remains is a rename, or a second
 * module-scope declaration of the same name, and neither is closed by scope. Both are visible in a
 * diff, which is the difference between this and the earlier fixes — those were beaten by things
 * invisible in a diff, a comment and then a string. Closing the rest needs dataflow and is not
 * attempted.
 *
 * THE INITIALIZER IS UNWRAPPED FIRST, and since this is the fourth fix here it is aimed at the
 * category rather than at what was reported. `("nyc.v2.8")` is a ParenthesizedExpression and
 * `"nyc.v2.8" as const` is an AsExpression, so neither is a string literal and the pin read as
 * ABSENT: a check blocking CI to say the constant disappeared, in front of a file that plainly
 * declares it. Each of the three previous fixes closed the shape in the review comment and left
 * the class behind, which is the habit this one is trying to break.
 *
 * The category is wrappers TypeScript ERASES. After compilation the initializer is the same string,
 * so the value read here is exactly the value the api compares, which is what makes unwrapping
 * sound rather than merely convenient — and it is the admission test for anything added to the list
 * later. A wrapper that changes the value at runtime, a call or a concatenation or a conditional,
 * is deliberately NOT here: those mean the pin is computed, this check cannot know it, and
 * reporting no pin is then the correct answer rather than a false positive.
 */
const ERASED_WRAPPERS = new Set([
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.AsExpression, // x as const, x as string
  ts.SyntaxKind.SatisfiesExpression, // x satisfies string
  ts.SyntaxKind.TypeAssertionExpression, // <string>x
  ts.SyntaxKind.NonNullExpression, // x!
]);
const unwrapped = (node) =>
  node !== undefined && ERASED_WRAPPERS.has(node.kind) ? unwrapped(node.expression) : node;

function pinnedVersion(sourceFile) {
  let pinned = null;
  const atModuleScope = (declaration) =>
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
    ts.isVariableStatement(declaration.parent.parent) &&
    declaration.parent.parent.parent === sourceFile;
  const visit = (node) => {
    const initializer = ts.isVariableDeclaration(node) ? unwrapped(node.initializer) : undefined;
    if (
      initializer !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === "EXPECTED_RULESET_VERSION" &&
      ts.isStringLiteralLike(initializer) &&
      atModuleScope(node)
    ) {
      pinned = initializer.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return pinned;
}

const scanned = filesUnder(repoRoot, (_relative, name) =>
  CODE_EXTENSIONS.some((extension) => name.endsWith(extension)),
);
const configFiles = filesUnder(repoRoot, (relative) => CONFIGURES_RULES_FILE.test(relative));
const manifests = filesUnder(repoRoot, (relative) => WORKSPACE_MANIFEST.test(relative));
const danglingReferences = [];

/** Each scanned file's parse, kept so the pin lookup reads the same tree rather than a second one. */
const parsedSource = new Map();

for (const file of scanned) {
  const relative = file.slice(repoRoot.length + 1);
  const source = readFileSync(file, "utf8");
  const { sourceFile, literals } = parseSource(relative, source);

  // A file that will not parse yields no literals, and no literals is indistinguishable from
  // nothing to find. Reported rather than scanned past, for the same reason every other narrowing
  // in this script is reported: a check that quietly stops looking reads exactly like a clean tree.
  if (sourceFile.parseDiagnostics.length > 0) {
    const first = sourceFile.parseDiagnostics[0];
    console.error(
      `${relative} could not be parsed, so it was not scanned: ` +
        ts.flattenDiagnosticMessageText(first.messageText, " ") +
        "\n\nA file this check cannot read is a file this check cannot vouch for.",
    );
    process.exit(1);
  }

  parsedSource.set(relative, sourceFile);
  const sourceLines = source.split(/\r?\n/);
  for (const found of danglingInLiterals(sourceFile, literals)) {
    if (claimsFixtureExemption(relative, sourceLines, found.line)) continue;
    danglingReferences.push({ file: relative, ...found });
  }
}

for (const file of configFiles) {
  const relative = file.slice(repoRoot.length + 1);
  for (const found of danglingIn(readFileSync(file, "utf8"), configFormat(relative))) {
    danglingReferences.push({ file: relative, ...found });
  }
}

for (const file of manifests) {
  const relative = file.slice(repoRoot.length + 1);
  for (const found of danglingInScripts(relative, readFileSync(file, "utf8"))) {
    danglingReferences.push({ file: relative, ...found });
  }
}

if (danglingReferences.length > 0) {
  console.error("A ruleset artifact is named that is not in the repo:\n");
  for (const reference of danglingReferences) {
    console.error(`  ✗ ${reference.file}:${reference.line} names ${reference.named}`);
  }
  console.error(
    `\nThe repo publishes: ${publishedRulesets().join(", ") || "(nothing under rules/)"}.\n` +
      "If you are mid version bump, this file was written after the last one and its grep could " +
      "not have found it. Point it at the published artifact — or better, stop naming a version: " +
      "read the rules directory, or take the path from apps/api/src/ruleset.ts, which is the one " +
      "place that is supposed to know.",
  );
  process.exit(1);
}

// The single constant allowed to name a version, checked against the artifact rather than banned.
// If the file bumps and the pin does not, the api refuses to boot; this fails first and says why.
// Read before the count is validated, so a repo holding two rulesets can be told which to keep.
const pinFile = "apps/api/src/ruleset.ts";
// Read as a DECLARATION from the parse tree. A regex over file text reported a commented-out
// assignment as the pin, and then an assignment-shaped string as the pin. Neither is a declaration,
// so neither can be mistaken for one now.
const pinTree =
  parsedSource.get(pinFile) ??
  parseSource(pinFile, readFileSync(join(repoRoot, pinFile), "utf8")).sourceFile;
const pinned = pinnedVersion(pinTree);
if (pinned === null) {
  console.error(
    `${pinFile} no longer declares EXPECTED_RULESET_VERSION as a module-scope const, which this\n` +
      "check reads as the one place allowed to pin a ruleset version. A `let` or `var` pin is\n" +
      "rejected on purpose: it can be reassigned after this check reads it, so the value confirmed\n" +
      "here would not be the value validateRuleset compares. If it moved, point this check at its\n" +
      "new home.",
  );
  process.exit(1);
}
// EXACTLY ONE published ruleset is the invariant, and anything else is an ERROR here rather than
// a reason to stand down.
//
// An earlier draft ran the pin check only when the count was one and said nothing otherwise, which
// put a silent-failure path inside the guard written to remove one: in the single state where the
// invariant is already broken, the check that would say so went quiet. And that state is not
// exotic — it is precisely mid-bump, a new version added and the old one not yet deleted, which is
// when someone most needs this working. A validator that stands down on ambiguous input looks
// exactly like a validator that passed.
const publishedNow = publishedRulesets();
if (publishedNow.length !== 1) {
  console.error(
    publishedNow.length === 0
      ? `No published ruleset in rules/. The api loads one at boot and every plan pins its ` +
          `version, so there is nothing for this check — or the product — to be right about.`
      : `rules/ holds ${publishedNow.length} published rulesets, and exactly one is the ` +
          `invariant:\n\n` +
          publishedNow.map((entry) => `  • ${entry}`).join("\n") +
          `\n\n${pinFile} pins ${pinned}, so that is the one to keep. A superseded ruleset is ` +
          `DELETED from the tree, not left beside its replacement: BASELINE.md records each one as ` +
          `a lineage row naming its git commit, which is how it stays recoverable. If you are ` +
          `mid-bump, this is the step between adding the new file and removing the old one.`,
  );
  process.exit(1);
}

// THE VERSION IS SPELLED IN THREE PLACES AND ALL THREE MUST AGREE: the artifact's filename, the
// `ruleset_version` inside it, and the api's pin. Comparing the JSON against the pin alone checked
// two of them and left the filename free to disagree, so a bump that renamed the file to
// `nyc-rules.v2.9.json` while both the field and the pin still said `nyc.v2.8` passed everything.
//
// That is worse than it sounds and is why it is checked here rather than left to review. Plans
// persist `ruleset_version` and replay against it (AD-7), and the snapshot banner reports it, so a
// publication that identifies itself as the version before it corrupts replay and tells organizers
// their plan came from rules it did not come from, with every check green.
//
// The filename is the anchor because it is what the manifest names and what a reader sees first.
// `<jurisdiction>-rules.<version>.json` publishes `<jurisdiction>.<version>`, derived rather than
// hardcoded so a second jurisdiction needs no change here.
const published = publishedNow[0];
const namedInFile = /^(.+)-rules\.(.+)\.json$/.exec(published);
if (namedInFile === null) {
  console.error(
    `${published} is not named <jurisdiction>-rules.<version>.json, so this check cannot derive ` +
      "the version the file claims to publish. Rename it or teach this check the new shape.",
  );
  process.exit(1);
}
const expectedVersion = `${namedInFile[1]}.${namedInFile[2]}`;
const publishedVersion = JSON.parse(
  readFileSync(join(repoRoot, "rules", published), "utf8"),
).ruleset_version;

const disagreements = [
  publishedVersion === expectedVersion
    ? null
    : `the file's own ruleset_version is ${publishedVersion}`,
  pinned === expectedVersion ? null : `${pinFile} pins ${pinned}`,
].filter(Boolean);

if (disagreements.length > 0) {
  console.error(
    `${published} is named for ${expectedVersion}, but ${disagreements.join(", and ")}.\n\n` +
      "The filename, the ruleset_version inside the file, and the api pin all name the same " +
      "publication, so all three move together or none do. Plans persist ruleset_version and " +
      "replay against it, so a file that identifies itself as an earlier version corrupts replay " +
      "and the snapshot banner while every other check stays green.",
  );
  process.exit(1);
}

// SPEC-CONFLICT #127 item 1: the four approved artifacts assign the same unscheduled Phase 2
// depth to F-203. Keeping this text-level check here makes the approved reconciliation durable.
const f203Artifacts = [
  "docs/BASELINE.md",
  "docs/ROADMAP.md",
  "docs/PRD.md",
  "specs/F-203-deadline-alerts.md",
];
const f203Capability = "(?:(?:alert )?escalations|digests|team reminders|per-user preferences)";
const f203Capabilities = new RegExp(
  `\\b${f203Capability}(?:,\\s+${f203Capability}){2},?\\s+and\\s+${f203Capability}\\b`,
  "i",
);
const f203ListOwner = /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*)?F-203\b(?:(?!\bF-\d+\b)[^—])*—/i;
const f203ListScope = new RegExp(
  `—\\s+${f203Capabilities.source};\\s+planned,\\s+(?:not scheduled|unscheduled)\\.?$`,
  "i",
);
const f203BaselineScope = new RegExp(
  `\\bF-203\\b\\s+(?:keeps|retains)\\s+${f203Capabilities.source}\\s+as its planned,`,
  "i",
);
const f203RoadmapDecision = /(?:^|\r?\n)\s*\*\*(?:Status|(?:Later\s+)?Decisions?)\b/i;
const f203PrdDecision =
  /(?:^|\r?\n)\s*\*\*(?:Status|Issue #127 amendment|(?:Later\s+)?Decisions?)\b/i;
const f203BaselineDecision = /^\s*\*\*(?:Status|(?:Later\s+)?Decisions?)\b/i;
const f203BaselineManifestRow =
  /^\s*\|\s*(Product requirements|Feature registry \+ phasing|Phase 1–1\.5 specs)\s*\|/i;
const f203BaselineManifestScope = new RegExp(
  `(?:\\bF-203\\b(?:\\s+scope amendment[^:|·]*:)?|` +
    "`specs/F-203-deadline-alerts\\.md`\\s+scope amended[^:|·]*:)" +
    `\\s+retains\\s+${f203Capabilities.source}\\s+as planned,\\s+unscheduled Phase \\d+ depth` +
    "\\.?\\s*(?=\\||·|$)",
  "i",
);
const f203SpecDecision = /^\s*\*\*(?:Status|(?:Later\s+)?Decisions?)\b/i;
const f203RetainedScope = new RegExp(
  `\\bF-203\\b\\s+retains\\s+${f203Capabilities.source}\\s+as planned,\\s+unscheduled\\b`,
  "i",
);
const f203SpecScope = new RegExp(`${f203Capabilities.source}\\s+remain\\b`, "i");
const f203CapabilityNames = ["escalations", "digests", "team reminders", "per-user preferences"];
const hasAllF203Capabilities = (text) =>
  f203CapabilityNames.every((capability) => text.toLowerCase().includes(capability));
const f203CapabilityMention =
  /\b(?:escalations?|digests?|team reminders?|per-user preferences?)\b/i;
const f203CriterionCapabilityList = `${f203CapabilityMention.source}(?:\\s+(?:and|or)\\s+${f203CapabilityMention.source})*`;
const f203CriterionNonGoal = new RegExp(
  `^\\s*(?:#{1,6}\\s+|(?:[-*+]|\\d+[.)])\\s+)?` +
    `(?:(?!${f203CapabilityMention.source})[^;.!?])*` +
    `(?:\\b(?:must|shall|should|does|do|will)\\s+not\\s+` +
    `(?:send|provide|implement|schedule|deliver|support|include|offer|enable)\\s+` +
    `${f203CriterionCapabilityList}|` +
    `\\b${f203CriterionCapabilityList}\\s+(?:is|are)\\s+` +
    `(?:a\\s+)?(?:non-goals?|out of scope|excluded)\\b)\\s*[.!]?\\s*$`,
  "i",
);
const f203NoAcceptanceCriteria =
  /\b(?:no|without)\s+(?:Phase\s+2\s+)?acceptance criteria\b|\bacceptance criteria\b[^.]*\b(?:none|not (?:defined|scheduled|included)|non-goal)\b/i;
const f203NoScopeChange =
  /\b(?:does|do|did|will)\s+not\s+(?:change|alter|modify)\s+(?:the\s+)?F-203(?:'s)?\s+(?:scope|depth|phase|scheduling)\s*[.!]?\s*$/i;
const isF203NonGoalCriterion = (text) =>
  f203CriterionNonGoal.test(text) || f203NoAcceptanceCriteria.test(text);
const f203DecisionScope =
  /\b(?:scope|depth|phase\s+\d+|planned|unplanned|scheduled|unscheduled|scheduling|acceptance criteria)\b/i;
const f203Planning = /\bplanned,\s+(?:not scheduled|unscheduled)\b/i;
const f203Negation =
  /\b(?:not planned|unplanned)\b|\b(?:is|are|was|were|has been|have been)\s+(?:superseded|rejected)\b|\b(?:no|without)\s+(?:alert )?(?:escalations|digests|team reminders|per-user preferences)\b/i;
const f203SchedulingConflict =
  /\b(?:(?:is|are|was|were|has been|have been|will be|must be|may be|can be)\s+(?:now\s+)?scheduled|now scheduled)\b/i;
function hasF203ConflictingPhase(text) {
  const phases = [];
  for (const clause of text.split(/[.!?;]+/)) {
    const features = [...clause.matchAll(/\bF-\d+\b/gi)];
    for (const [index, feature] of features.entries()) {
      if (feature[0].toUpperCase() !== "F-203") continue;
      const segment = clause.slice(feature.index, features[index + 1]?.index ?? clause.length);
      phases.push(...[...segment.matchAll(/\bPhase\s+(\d+)\b/gi)].map((match) => match[1]));
    }
    phases.push(
      ...[
        ...clause.matchAll(
          /\bPhase\s+(\d+)\b(?:(?!\bF-\d+\b).)*\b(?:scope|depth)\b(?:(?!\bF-\d+\b).)*\bunder F-203\b/gi,
        ),
      ].map((match) => match[1]),
    );
  }
  return phases.includes("2") && phases.some((phase) => phase !== "2");
}
const f203SpecAssignment =
  /\bF-203\b[^.]*\b(?:keeps|retains|owns|includes)\b|\b(?:remain|remains|are)\b[^.]*\bunder F-203\b/i;
const f203Failures = [];

function activeMarkdown(markdown) {
  const lines = markdown.replace(/<!--[\s\S]*?(?:-->|$)/g, "").split(/\r?\n/);
  let fence = null;
  let continuesListItem = false;
  return lines
    .map((line) => {
      const marker = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(line);
      const markerIndent = marker?.[1].replace(/\t/g, "    ").length ?? 0;
      const isFenceMarker =
        marker !== null && (markerIndent <= 3 || continuesListItem || fence !== null);
      if (fence === null && isFenceMarker) {
        fence = marker[2];
        continuesListItem = false;
        return "";
      }
      if (
        fence !== null &&
        isFenceMarker &&
        marker[2][0] === fence[0] &&
        marker[2].length >= fence.length &&
        marker[3].trim() === ""
      ) {
        fence = null;
        return "";
      }
      if (fence !== null) return "";
      if (/^(?: {4}|\t)/.test(line)) return continuesListItem ? line : "";
      continuesListItem = /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
      return line;
    })
    .join("\n");
}

function parseMarkdownHeadings(markdown) {
  return [
    ...[...markdown.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)].map((heading) => ({
      index: heading.index ?? 0,
      end: (heading.index ?? 0) + heading[0].length,
      level: heading[1].length,
      title: heading[2],
    })),
    ...[...markdown.matchAll(/^(.+\S)[ \t]*\r?\n(=+|-+)[ \t]*$/gm)].map((heading) => ({
      index: heading.index ?? 0,
      end: (heading.index ?? 0) + heading[0].length,
      level: heading[2][0] === "=" ? 1 : 2,
      title: heading[1],
    })),
  ].sort((left, right) => left.index - right.index);
}

function f203OwningPhase(headings, offset) {
  let descendantLevel = 7;
  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const heading = headings[index];
    if (heading.index >= offset || heading.level >= descendantLevel) continue;
    descendantLevel = heading.level;
    const phase = /\bPhase\s+(\d+)\b/i.exec(heading.title);
    if (phase) return phase[1];
  }
  return undefined;
}

function isOnlyNonMutatingF203Reference(text) {
  const references = text.split(/(?<=[.!?])\s+/).filter((sentence) => /\bF-203\b/i.test(sentence));
  return references.length > 0 && references.every((sentence) => f203NoScopeChange.test(sentence));
}

for (const relative of f203Artifacts) {
  const full = join(repoRoot, relative);
  if (!existsSync(full)) {
    f203Failures.push(`${relative} is missing`);
    continue;
  }

  const contents = activeMarkdown(readFileSync(full, "utf8"));
  const headings = parseMarkdownHeadings(contents);
  if (relative === "specs/F-203-deadline-alerts.md") {
    const acceptanceCriteriaSections = headings
      .filter(({ title }) => /\bAcceptance Criteria\b/i.test(title))
      .map((heading) => {
        const nextPeerHeading = headings.find(
          (candidate) => candidate.index > heading.index && candidate.level <= heading.level,
        );
        return contents.slice(heading.end, nextPeerHeading?.index ?? contents.length);
      });
    const acceptanceCriteriaText = acceptanceCriteriaSections.join("\n");
    const addsUnscheduledCriterion = acceptanceCriteriaText
      .split(/\r?\n(?=\s*(?:[-*+]|\d+[.)])\s+)/)
      .some(
        (criterion) =>
          /^\s*(?:[-*+]|\d+[.)])\s+/.test(criterion) &&
          f203CapabilityMention.test(criterion) &&
          !isF203NonGoalCriterion(criterion),
      );
    const addsUnscheduledProseCriterion = acceptanceCriteriaSections
      .flatMap((section) => section.split(/\r?\n\s*\r?\n/))
      .some((paragraph) => {
        const prose = paragraph
          .split(/\r?\n/)
          .filter((line) => !/^#{1,6}\s+/.test(line))
          .join(" ")
          .trim();
        return (
          prose !== "" &&
          !/^(?:[-*+]|\d+[.)])\s+|\|/.test(prose) &&
          f203CapabilityMention.test(prose) &&
          !isF203NonGoalCriterion(prose)
        );
      });
    const tableLines = acceptanceCriteriaText.split(/\r?\n/);
    const tableDelimiter = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;
    const addsUnscheduledTableCriterion = tableLines.some((row, index) => {
      if (
        !/^\s*\|/.test(row) ||
        tableDelimiter.test(row) ||
        tableDelimiter.test(tableLines[index + 1] ?? "")
      ) {
        return false;
      }
      const criterion = row.replace(/^\s*\|\s*|\s*\|\s*$/g, "");
      return f203CapabilityMention.test(criterion) && !isF203NonGoalCriterion(criterion);
    });
    const addsHeadingScopedCriterion = acceptanceCriteriaSections.some((section) => {
      const lines = section.split(/\r?\n/);
      let capabilityHeadingLevel = null;
      return lines.some((line, index) => {
        const heading = /^(#{1,6})\s+/.exec(line);
        if (heading) {
          const namesCapability = f203CapabilityMention.test(line);
          if (namesCapability) capabilityHeadingLevel = heading[1].length;
          else if (capabilityHeadingLevel !== null && heading[1].length <= capabilityHeadingLevel) {
            capabilityHeadingLevel = null;
          }
          return namesCapability && !isF203NonGoalCriterion(line);
        }
        if (capabilityHeadingLevel === null) return false;
        const isListCriterion = /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
        const isTableCriterion =
          /^\s*\|/.test(line) &&
          !tableDelimiter.test(line) &&
          !tableDelimiter.test(lines[index + 1] ?? "");
        const isProseCriterion = line.trim() !== "" && !isListCriterion && !/^\s*\|/.test(line);
        return (
          (isListCriterion || isTableCriterion || isProseCriterion) && !isF203NonGoalCriterion(line)
        );
      });
    });
    if (
      addsUnscheduledCriterion ||
      addsUnscheduledProseCriterion ||
      addsUnscheduledTableCriterion ||
      addsHeadingScopedCriterion ||
      headings.some(
        ({ title }) =>
          /(?:Phase 2\b.*\bAcceptance Criteria|Acceptance Criteria\b.*\bPhase 2)\b/i.test(title) &&
          !f203NoAcceptanceCriteria.test(title),
      )
    ) {
      f203Failures.push(
        "specs/F-203-deadline-alerts.md must not define Phase 2 acceptance criteria while " +
          "its Phase 2 scope is planned but unscheduled",
      );
    }
  }
  let nextStatementOffset = 0;
  const scopeStatements = contents
    .split(
      /\r?\n\s*\r?\n|\r?\n(?=\|)|\r?\n(?=(?:(?:[-*+]|\d+[.)])\s+|\s*\*\*(?:Status|(?:Later\s+)?Decisions?|Issue #\d+ amendment)\b))/i,
    )
    .map((raw) => {
      const offset = contents.indexOf(raw, nextStatementOffset);
      nextStatementOffset = offset + raw.length;
      return { raw, offset, normalized: raw.replace(/\s+/g, " ").trim() };
    })
    .filter(({ raw, normalized }) => {
      const lower = normalized.toLowerCase();
      const namesScope = f203CapabilityNames.some((capability) => lower.includes(capability));
      const sentences = normalized.split(/(?<=[.!?])\s+/);
      const addressesScope =
        sentences.some(
          (sentence) =>
            sentence.toLowerCase().includes("f-203") &&
            (f203CapabilityMention.test(sentence) || f203DecisionScope.test(sentence)),
        ) ||
        sentences.some((sentence, index) => {
          const continuation = sentences[index + 1] ?? "";
          return (
            sentence.toLowerCase().includes("f-203") &&
            /^(?:It|Its|This|That|The (?:feature|scope))\b/i.test(continuation) &&
            f203DecisionScope.test(continuation)
          );
        });
      const requiresListAssignment = relative === "docs/ROADMAP.md" || relative === "docs/PRD.md";
      const isListAssignment = requiresListAssignment && /^\s*(?:[-*+]|\d+[.)])\s+/.test(raw);
      const isTableAssignment = requiresListAssignment && /^\s*\|/.test(raw);
      if (requiresListAssignment) {
        if (isOnlyNonMutatingF203Reference(normalized)) return false;
        if (relative === "docs/ROADMAP.md" && f203RoadmapDecision.test(raw)) {
          return lower.includes("f-203") && addressesScope;
        }
        if (relative === "docs/PRD.md" && f203PrdDecision.test(raw)) {
          return lower.includes("f-203") && addressesScope;
        }
        if (!isListAssignment) {
          return (
            lower.includes("f-203") &&
            addressesScope &&
            (isTableAssignment || f203SpecAssignment.test(normalized))
          );
        }
        const ownsF203 = f203ListOwner.test(raw);
        const isRoadmapCore =
          relative === "docs/ROADMAP.md" &&
          /^\s*[-*+]\s+\*\*F-203\s+·\s+Deadline Alerts\*\*/i.test(raw);
        if (isRoadmapCore) return namesScope;
        const ownerNamesF203 = /\bF-203\b/i.test(raw.split("—", 1)[0]);
        return isListAssignment && (ownsF203 || (namesScope && ownerNamesF203));
      }
      if (relative === "docs/BASELINE.md") {
        if (isOnlyNonMutatingF203Reference(normalized)) return false;
        if (f203BaselineManifestRow.test(raw)) return true;
        return f203BaselineDecision.test(raw) && lower.includes("f-203") && addressesScope;
      }
      if (f203SpecDecision.test(raw)) return lower.includes("f-203") && addressesScope;
      if (relative === "specs/F-203-deadline-alerts.md" && f203SpecAssignment.test(normalized)) {
        return true;
      }
      if (!namesScope || !lower.includes("f-203")) return false;
      return f203SpecAssignment.test(normalized);
    });

  const invalidAssignment = scopeStatements.find(({ raw, normalized }) => {
    const isScopeDecision =
      (relative === "docs/ROADMAP.md" && f203RoadmapDecision.test(raw)) ||
      (relative === "docs/PRD.md" && f203PrdDecision.test(raw));
    if (isScopeDecision) {
      const remaining = normalized.replace(f203RetainedScope, "");
      return (
        !f203RetainedScope.test(normalized) ||
        !hasAllF203Capabilities(normalized) ||
        f203Negation.test(normalized) ||
        f203SchedulingConflict.test(normalized) ||
        hasF203ConflictingPhase(normalized) ||
        f203SpecAssignment.test(remaining)
      );
    }
    if (relative === "specs/F-203-deadline-alerts.md" && f203SpecDecision.test(raw)) {
      if (f203Negation.test(normalized) || f203SchedulingConflict.test(normalized)) return true;
      if (!f203CapabilityMention.test(normalized)) return false;
      const hasCompleteScope =
        f203RetainedScope.test(normalized) ||
        (f203SpecScope.test(normalized) &&
          hasAllF203Capabilities(normalized) &&
          f203Planning.test(normalized));
      const remaining = normalized.replace(f203RetainedScope, "").replace(f203SpecScope, "");
      return !hasCompleteScope || f203SpecAssignment.test(remaining);
    }
    const ownerSeparator = normalized.indexOf("—");
    const assignedScope =
      /^\s*(?:[-*+]|\d+[.)])\s+/.test(raw) && ownerSeparator >= 0
        ? normalized.slice(ownerSeparator + 1)
        : normalized;
    if (
      !f203Capabilities.test(assignedScope) ||
      !hasAllF203Capabilities(assignedScope) ||
      !f203Planning.test(normalized)
    ) {
      return true;
    }
    if (f203Negation.test(normalized) || f203SchedulingConflict.test(normalized)) {
      return true;
    }
    if (relative === "docs/ROADMAP.md" || relative === "docs/PRD.md") {
      if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(raw)) return false;
      return !f203ListOwner.test(raw) || !f203ListScope.test(normalized);
    }
    if (relative === "docs/BASELINE.md") {
      if (f203BaselineManifestRow.test(raw)) {
        if (hasF203ConflictingPhase(normalized)) return false;
        if (!f203BaselineManifestScope.test(normalized)) return true;
        const remaining = normalized.replace(f203BaselineManifestScope, "").replace(/`[^`]*`/g, "");
        return f203SpecAssignment.test(remaining);
      }
      const remaining = normalized.replace(f203BaselineScope, "");
      return !f203BaselineScope.test(normalized) || f203SpecAssignment.test(remaining);
    }
    return (
      !f203SpecScope.test(normalized) ||
      !/\bper-user preferences\b[^.]*\bunder F-203\b/i.test(normalized)
    );
  });
  const baselineManifestRows = scopeStatements.filter(({ raw }) =>
    f203BaselineManifestRow.test(raw),
  );
  const baselineManifestConcerns = new Set(
    baselineManifestRows.map(({ raw }) => f203BaselineManifestRow.exec(raw)?.[1].toLowerCase()),
  );
  const missingRequiredAssignment =
    ((relative === "docs/ROADMAP.md" || relative === "docs/PRD.md") &&
      (!scopeStatements.some(({ raw }) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(raw)) ||
        !scopeStatements.some(({ raw }) =>
          relative === "docs/ROADMAP.md"
            ? f203RoadmapDecision.test(raw)
            : f203PrdDecision.test(raw),
        ))) ||
    (relative === "docs/BASELINE.md" &&
      (baselineManifestRows.length !== 3 || baselineManifestConcerns.size !== 3)) ||
    (relative === "specs/F-203-deadline-alerts.md" &&
      !scopeStatements.some(
        ({ raw, normalized }) =>
          !f203SpecDecision.test(raw) &&
          f203SpecScope.test(normalized) &&
          hasAllF203Capabilities(normalized),
      ));
  if (scopeStatements.length === 0 || missingRequiredAssignment || invalidAssignment) {
    f203Failures.push(
      `${relative} must affirmatively assign escalations, digests, team reminders, and ` +
        "per-user preferences to F-203 as planned, unscheduled Phase 2 scope",
    );
  } else if (relative === "docs/BASELINE.md" || relative === "specs/F-203-deadline-alerts.md") {
    const bindsPhase2 = scopeStatements.every(
      ({ normalized }) =>
        !hasF203ConflictingPhase(normalized) &&
        (relative === "docs/BASELINE.md"
          ? /\bplanned,\s+(?:not scheduled|unscheduled)\s+Phase 2\b/i.test(normalized)
          : /\bPhase 2\b[^.]*\bunder F-203\b/i.test(normalized)),
    );
    if (!bindsPhase2) {
      f203Failures.push(`${relative} must assign its F-203 full scope to Phase 2`);
    }
  } else {
    const underPhase2 = scopeStatements.every(({ raw, offset, normalized }) => {
      const isScopeDecision =
        (relative === "docs/ROADMAP.md" && f203RoadmapDecision.test(raw)) ||
        (relative === "docs/PRD.md" && f203PrdDecision.test(raw));
      if (isScopeDecision) {
        return /\bunscheduled\s+Phase 2\s+depth\b/i.test(normalized);
      }
      return f203OwningPhase(headings, offset) === "2";
    });
    if (!underPhase2) {
      f203Failures.push(`${relative} must keep its F-203 full-scope assignment under Phase 2`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// SPEC-CONFLICT #127 item 2: Square/POS scope agreement (governance §5 step 7).
//
// The reconciliation dropped a standalone `Square/POS integrations` bullet from ROADMAP Phase 4
// because it contradicted PRD.md:226, which scopes the Square capability to the inventory
// low-stock webhook and assigns it to F-408. Governance §5 step 7 requires a rule so the
// contradiction cannot silently return, and a one-time edit is not one: it closes the disagreement
// once and leaves it free to come back on the next edit to any of the three files.
//
// WHY HERE rather than in a test. This file is already the repo's cross-artifact governance gate
// rather than a BASELINE-only checker: it enforces the manifest-versus-header rule, the
// exactly-one-published-ruleset rule, and the filename/field/pin agreement rule. A documentation
// invariant that governance requires belongs beside those and behind `pnpm check:baseline`, which
// is the gate governance work is run through. It is nonetheless proved the same way every other
// rule here is proved, against a planted tree in check-baseline-drift.test.mjs.
//
// THE DECISION HAS TWO HALVES AND THE FIRST VERSION OF THIS RULE ONLY GUARDED ONE. It required a
// scope line to name F-408 and stopped there, which defends against the shape nobody would write
// (a bullet with no id) and permits the shape someone would: renaming F-408's own entry to
// "Inventory Alerts and Square/POS Integrations" absorbs the dropped capability under the id that
// already exists, names F-408 throughout, and passed. That is precisely the WIDENING branch the
// product owner did not take, because it changes an assigned ID's meaning against DESIGN.md:25.
// So the rule below guards the absence of the broader capability FIRST and independently of any
// id, and checks the id assignment second.
//
// RULE A, the core: no capability ENTRY in the three artifacts may pair `Square` or a standalone
// `POS` with `integration`. The reconciled artifacts spell the kept capability as "Square webhook";
// every form of the dropped one, standalone or absorbed, is spelled with "integrations". This is
// deliberately independent of F-ids, so a new id, F-408 itself, and an unassigned bullet all fail
// the same way.
//
// RULE B: an entry that names `Square` AND names at least one F-id must name F-408, so the
// capability cannot be reassigned to another id. Requiring an F-id is what keeps a provider MENTION
// from reading as an assignment: "Square adapter credentials must be encrypted" is a list item
// about a provider, assigns nothing, and must pass. A line can be an entry and still not assign a
// capability, which is the same false positive as the code-block one below, one level in.
//
// RULE C: the assignment must still be PRESENT in the Roadmap and the PRD, and ARCHITECTURE-FUTURE
// §9.3 must still own F-408, so deleting the assignment cannot pass by leaving nothing to disagree
// with.
//
// WHAT COUNTS AS AN ENTRY, and why it is not any line mentioning POS. ARCHITECTURE-FUTURE names POS
// three times as a PROVIDER CLASS behind an adapter: AD-13, the integrations package listing, and
// the Phase 2+ worker list. None assigns a capability to an id and none should have to name one, so
// matching every POS mention fails a compliant tree. An entry is a list item or a table row,
// because that is what a capability assignment is in these three documents. Prose is out of scope
// on purpose: the paragraph recording the drop is prose ABOUT an entry and necessarily repeats its
// words, so matching prose would make the rule fail on the very edit it exists to protect. The
// package listing is inside a fenced block and is not an entry either.
//
// A MISSING ARTIFACT IS A FAILURE, not a skip. The status loop above uses `if (!existsSync) continue`
// deliberately, because it walks manifest rows including globs and files a row may name before they
// are created. That reasoning does not carry here: these three paths are named explicitly by this
// rule, all three exist, and each is an APPROVED row in the manifest. A guard whose subject can be
// deleted into a pass is not a guard, and renaming one of these files is exactly the edit that
// would do it.
const posArtifacts = ["docs/ROADMAP.md", "docs/PRD.md", "docs/ARCHITECTURE-FUTURE.md"];
const posFailures = [];
const squareAssignments = new Map();

for (const relative of posArtifacts) {
  const full = join(repoRoot, relative);
  if (!existsSync(full)) {
    posFailures.push(
      `${relative} is missing. This rule names it explicitly and the manifest marks it APPROVED, ` +
        `so its absence is a governance event rather than a state to skip past. If it moved, ` +
        `point this rule at its new path in the same PR.`,
    );
    continue;
  }
  const lines = readFileSync(full, "utf8").split("\n");
  let namesSquareWithF408 = 0;
  lines.forEach((line, index) => {
    const isEntry = /^\s*[-*]\s/.test(line) || /^\s*\|/.test(line);
    if (!isEntry) return;
    const mentionsSquare = /\bSquare\b/.test(line);
    const standalonePos = /\bPOS\b/.test(line);
    if (!mentionsSquare && !standalonePos) return;

    // RULE A. The broader capability, however it is spelled and whoever it is assigned to.
    //
    // The words must be ADJACENT, not merely both present. `PRD.md:226` reads "ticketing
    // integration/export; inventory low-stock alerts (manual counts or Square webhook)": that
    // "integration" belongs to F-308's ticketing, and a line-wide test flagged the compliant PRD
    // entry as the dropped capability. The capability is always spelled as the noun phrase, so the
    // pattern is the noun phrase.
    if (/\b(?:Square|POS)(?:\s*\/\s*(?:Square|POS))?\s+integrations?\b/i.test(line)) {
      posFailures.push(
        `${relative}:${index + 1} asserts the broader standalone Square/POS capability, which the ` +
          `reconciliation DROPPED:\n      ${line.trim()}`,
      );
      return;
    }

    // RULE B. Only an entry that names an id is an assignment; a provider mention is not.
    if (!/\bF-\d{3}\b/.test(line)) return;
    if (!line.includes("F-408")) {
      posFailures.push(
        `${relative}:${index + 1} assigns the Square capability to an id other than F-408:\n` +
          `      ${line.trim()}`,
      );
      return;
    }
    if (mentionsSquare) namesSquareWithF408 += 1;
  });
  squareAssignments.set(relative, namesSquareWithF408);
}

// RULE C, first half.
for (const relative of ["docs/ROADMAP.md", "docs/PRD.md"]) {
  if (!existsSync(join(repoRoot, relative))) continue;
  if ((squareAssignments.get(relative) ?? 0) === 0) {
    posFailures.push(
      `${relative} no longer assigns the Square capability to F-408. The three artifacts agree ` +
        `only while each of them says so.`,
    );
  }
}

// RULE C, second half. ARCHITECTURE-FUTURE carries the assignment on its §9.3 ownership row rather
// than by naming the vendor: the row places F-408 in the External integrations module, and that is
// ALL it does. It does not scope F-408 to Square, to inventory or to a webhook, which PRD.md:226 is
// the artifact that does. So this checks the row for what it actually carries, module ownership.
const afPath = join(repoRoot, "docs/ARCHITECTURE-FUTURE.md");
if (existsSync(afPath)) {
  const ownsExternal = readFileSync(afPath, "utf8")
    .split("\n")
    .some((line) => /External integrations/.test(line) && line.includes("F-408"));
  if (!ownsExternal) {
    posFailures.push(
      "docs/ARCHITECTURE-FUTURE.md §9.3 no longer lists F-408 on its External integrations " +
        "ownership row, so the Square capability has no owning module there.",
    );
  }
}

if (posFailures.length > 0) {
  console.error(
    "Square/POS scope disagreement (SPEC-CONFLICT #127 item 2, reconciled 2026-07-28):\n",
  );
  for (const f of posFailures) console.error("  ✗ " + f);
  console.error(
    "\nThe decision was the NARROWING branch: F-408 keeps its established meaning, Inventory " +
      "Low-Stock Alerts, scoped to the inventory Square webhook by PRD.md:226, and the broader " +
      "standalone POS capability is dropped rather than absorbed. Absorbing it under F-408's name " +
      "is the WIDENING branch: it changes an assigned ID's meaning and needs an amendment to " +
      "docs/DESIGN.md:25. A new capability needs a new ID and a new product decision. Either way " +
      "this rule moves with the decision that changed it, not around it.",
  );
  process.exit(1);
}

if (f203Failures.length > 0) {
  console.error("F-203 Phase 2 scope disagreement (SPEC-CONFLICT #127 item 1):\n");
  for (const failure of f203Failures) console.error("  ✗ " + failure);
  process.exit(1);
}

if (failures.length > 0) {
  console.error("Baseline status drift detected (docs/BASELINE.md vs file headers):\n");
  for (const f of failures) console.error("  ✗ " + f);
  console.error(
    "\nReconcile the file header to APPROVED (or fix the manifest) in one PR. See issue #70.",
  );
  process.exit(1);
}

console.log(
  `Ruleset reference check passed: ${scanned.length} source, ${configFiles.length} config and ` +
    `${manifests.length} manifest files scanned, every ruleset name exists, and ${pinFile} pins ` +
    `${pinned}.`,
);
console.log(`Baseline status check passed: ${checked.length} APPROVED artifacts consistent.`);
console.log(
  `Square/POS scope check passed: ${posArtifacts.length} artifacts agree that the capability is `.concat(
    "F-408's and that no standalone POS entry exists (SPEC-CONFLICT #127 item 2).",
  ),
);
console.log(
  `F-203 scope check passed: ${f203Artifacts.length} artifacts retain the same planned, ` +
    "unscheduled Phase 2 capabilities (SPEC-CONFLICT #127 item 1).",
);
for (const c of checked) console.log("  ✓ " + c);

if (headerless.length > 0) {
  console.warn(
    `\n${headerless.length} file(s) the manifest marks APPROVED declare no status header of ` +
      `their own, so the manifest row is their only approval record (governance §7):`,
  );
  for (const rel of headerless) console.warn("  ! " + rel);
}
