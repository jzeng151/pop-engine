#!/usr/bin/env node
// Baseline status-drift check (governance §3; regression guard for issue #70).

import { readFileSync, existsSync, readdirSync } from "node:fs";
import ts from "typescript";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

/** The tree to check. */
const repoRoot = process.env.BASELINE_CHECK_ROOT
  ? resolve(process.env.BASELINE_CHECK_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(repoRoot, "docs/BASELINE.md");

/** What a manifest row may name as an artifact when it WRITES A NAME OUT: a local `.md` or `.json` path. */
const ARTIFACT_PATH = /^[\w./-]+\.(md|json)$/;

/** Expand a manifest glob (`specs/F-*.md`) to the files it actually covers. */
function expandGlob(token) {
  const slash = token.lastIndexOf("/");
  const directory = slash === -1 ? "" : token.slice(0, slash);
  const pattern = token.slice(slash + 1);
  if (directory.includes("*") || (pattern.match(/\*/g) ?? []).length !== 1) return null;
  const [prefix, suffix] = pattern.split("*");
  const absoluteDirectory = join(repoRoot, directory);
  if (!existsSync(absoluteDirectory)) return [];
  let entries;
  try {
    entries = readdirSync(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    return { error: error.message };
  }
  return (
    entries
      // isFile, NOT not-isDirectory. A broken symlink is neither a directory nor a file, so the
      // negative test admitted one whose name carries the expected suffix; the later `existsSync`
      // then FOLLOWS the missing target, finds nothing, and skips the entry silently. The run exits
      // 0 having verified nothing for a path a manifest row calls APPROVED, which is the same
      // outcome as the unreadable-name defect this filter was added for (#252 review). Sockets,
      // FIFOs and devices go the same way and for the same reason: a status can only be read from a
      // file.
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
      .map((name) => (directory === "" ? name : `${directory}/${name}`))
      .sort()
  );
}

/** Pull backticked local .md/.json paths out of a manifest table row, expanding globs. */
function filePathsInRow(row, label) {
  const paths = [];
  for (const match of row.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim().replace(/^\//, ""); // `/AGENTS.md` -> AGENTS.md
    if (token.includes("*")) {
      const expanded = expandGlob(token);
      if (expanded === null) {
        unsupportedGlobs.push(token);
        continue;
      }
      if (expanded.error !== undefined) {
        unreadable.push(
          `${token}: named by manifest row "${label}", and the directory it globs cannot be ` +
            `listed (${expanded.error})`,
        );
        continue;
      }
      // A glob matching nothing means the row claims APPROVED for a set of artifacts and the check then inspects none of them.
      if (expanded.length === 0) {
        emptyGlobs.push(token);
        continue;
      }
      paths.push(...expanded);
      continue;
    }
    if (ARTIFACT_PATH.test(token)) paths.push(token);
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

// The row loop below skips every line that is not a table row, so a merge that commits conflict markers leaves the manifest malformed and this check green — which is how `<<<<<<< HEAD` reached main in 370be18.
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

/** Approved artifact path -> the manifest row that named it, so a failure can say which row. */
const approvedFiles = new Map();
const unsupportedGlobs = [];
const emptyGlobs = [];
/** Paths a row names that exist and cannot be read as artifacts, with the row that named them. */
const unreadable = [];
/** Rows publishing a digest: `{ file, expected, row, malformed? }`. */
const checksumClaims = [];
for (const row of baseline.split(/\r?\n/)) {
  if (!row.startsWith("|")) continue;
  const cells = row.split("|").map((c) => c.trim());
  // cells[0] is empty (leading pipe); status is the 3rd content column.
  const statusCell = cells[3] ?? "";
  if (!/APPROVED/i.test(statusCell)) continue;
  const rowLabel = cells[1] || row.slice(0, 60);
  const paths = filePathsInRow(row, rowLabel);
  for (const p of paths) {
    if (!approvedFiles.has(p)) approvedFiles.set(p, rowLabel);
  }

  // A digest belongs to the artifact named in the same row, so the pairing is positional rather than guessed: one path and one digest, or the row is ambiguous and says so.
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

for (const rel of [...approvedFiles.keys()].sort()) {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) continue; // manifest may reference not-yet-created files
  // A path that exists and cannot be read as a status-carrying artifact is drift, and it has to READ as drift.
  let status;
  try {
    status = declaredStatus(abs);
  } catch (error) {
    unreadable.push(
      `${rel}: named by manifest row "${approvedFiles.get(rel)}", and cannot be read as an ` +
        `artifact (${error.message})`,
    );
    continue;
  }
  if (status === null) {
    // Warn, do not fail.
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
  // Over the exact bytes on disk.
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch (error) {
    unreadable.push(
      `${claim.file}: named by manifest row "${claim.row}", publishes a sha256, and cannot be ` +
        `read as an artifact (${error.message})`,
    );
    continue;
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
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

// Ruleset references in executable code must resolve to published artifacts.
const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js", ".jsx"];

/** The directories that are not this repo's source, READ FROM `.gitignore` rather than listed here. */
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

/** Whether `.gitignore` says a FILE is not part of this repo, negations honoured. */
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

/** Every file under `directory` that `matches`, skipping the trees that are not this repo's source. */
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

/** What the runtime counts as a published ruleset. */
const PUBLISHED_RULESET = /^nyc-rules\.v.+\.json$/;

/** What the repo actually publishes, so the message can say so rather than only what is wrong. */
let publishedCache = null;
const publishedRulesets = () => {
  // WITH ENTRY TYPES, because a name alone does not make something a ruleset a deployment can open.
  publishedCache ??= readdirSync(join(repoRoot, "rules"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && PUBLISHED_RULESET.test(entry.name))
    .map((entry) => entry.name);
  return publishedCache;
};

/** Where a named ruleset must exist for a reference to it to resolve. */
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

/** Whether `named`, appearing at `at` inside `text`, names a file that exists where it points. */
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
const RULESET_FILENAME_IN_VALUE = /nyc-rules\.[^/]*/g;
const RULESET_FILENAME_IN_TEXT = /nyc-rules\.[^\s/'"`{}]*/g;

/** How a double-quoted scalar decodes, PER FORMAT, because the two formats this reads are not remotely the same and round 12 gave them one decoder. */
const decodeYamlEscapes = (value) =>
  value.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (whole, escape) => {
    if (escape[0] === "x" || escape[0] === "u")
      return String.fromCharCode(parseInt(escape.slice(1), 16));
    const simple = { n: "\n", t: "\t", r: "\r", 0: "\0", "\\": "\\", '"': '"', "/": "/" };
    return simple[escape] ?? whole;
  });

/** `--env-file` honours `\n` in a double-quoted value and nothing else. Observed, see above. */
const decodeDotenvEscapes = (value) => value.replace(/\\n/g, "\n");

/** dotenv values, found from the ASSIGNMENT rather than by hunting quotes. */
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

/** YAML values: quoted scalars, and the BLOCK scalars that were missing. */
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

/** Dotenv and YAML require separate scalar segmenters because their quoting rules differ. */
const CONFIG_FORMATS = {
  // `\"` DOES NOT ESCAPE in a `.env` value, so the scalar really does end at that quote and the backslash stays in the value.
  dotenv: { values: dotenvValues },
  // ESCAPE-AWARE, because YAML's double-quoted scalar defines `\"` and a segmenter that stops at the first quote loses to it.
  yaml: { values: yamlValues },
};

/** `.env`, `.env.example` and friends load through `--env-file`; the rest of the set is YAML. */
const configFormat = (relative) => (/(^|\/)\.env(\..+)?$/.test(relative) ? "dotenv" : "yaml");

/** Where `text` has a ruleset name that is not one of the files that exist, and on what line. */
function danglingIn(text, format = "yaml") {
  const found = [];
  const { values } = CONFIG_FORMATS[format];
  const lineOf = (index) => text.slice(0, index).split("\n").length;
  // `at` is where the segment starts in the file.
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

/** The same search, confined to the string literals the parser found. */
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

/** The one exemption, and the only one: a line in a TEST file that declares its ruleset names are fixtures rather than paths. */
const FIXTURE_NAMES_MARKER = "baseline-check: fixture ruleset names";

/** A COPY of `vitest.config.ts`'s `include`, and the copy is deliberate for the same reason `PUBLISHED_RULESET` is one. */
const VITEST_INCLUDE = [
  "{apps,packages}/*/src/**/*.test.{ts,tsx}",
  "apps/web/app/**/*.test.{ts,tsx}",
  "scripts/**/*.test.mjs",
];

const VITEST_EXCLUDE = ["scripts/dedupe-cofiring/**"];

/** One include glob as a regular expression, supporting exactly the three constructs vitest's patterns use here: `{a,b}` alternation, `**` across directories, and `*` within a segment. */
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
      // A globstar plus slash spans zero or more directories.
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
const VITEST_SKIPS = VITEST_EXCLUDE.map(globToRegExp);

/** Whether `file` is collected by Vitest and `line` claims the fixture exemption. */
function claimsFixtureExemption(relative, sourceLines, line) {
  if (!VITEST_COLLECTS.some((pattern) => pattern.test(relative))) return false;
  if (VITEST_SKIPS.some((pattern) => pattern.test(relative))) return false;
  const own = sourceLines[line - 1] ?? "";
  const above = sourceLines[line - 2] ?? "";
  return own.includes(FIXTURE_NAMES_MARKER) || above.includes(FIXTURE_NAMES_MARKER);
}

/** Files that can set `RULES_FILE`, which is the override the resolver reads before its default. */
const CONFIGURES_RULES_FILE =
  /(^|\/)(\.env(\..+)?|docker-compose.*\.ya?ml)$|^\.github\/workflows\/.+\.ya?ml$/;

/** Workspace manifests, whose `scripts` are executable entry points and were not being read. */
const WORKSPACE_MANIFEST = /^(package\.json|(apps|packages)\/[^/]+\/package\.json)$/;

/** A shell command split into the words the shell would pass along, with its quoting removed. */
const SHELL_OPERATORS = new Set([";", "&", "|", "<", ">", "(", ")"]);

function shellWords(command) {
  const words = [];
  let word = null;
  let quote = null;
  let backquoted = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    // A backquote is literal ONLY inside single quotes, which is why this is not in the operator set: the set is consulted for unquoted text alone, and a backquote still opens a substitution inside a double-quoted string.
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
    // ONE WORD AT A TIME, with the shell's quoting taken off first.
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

/** The string literals a JavaScript or TypeScript source contains, found by PARSING it. */
// One entry per `CODE_EXTENSIONS` member.
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

/** The tag applied to a template literal part, or null if there is none. */
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
      // `values` is every candidate for what this literal IS at runtime, and judging candidates rather than one form is what the tag forced.
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

/** The version the api pins, read as a MODULE-SCOPE declaration. */
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

  // A file that will not parse yields no literals, and no literals is indistinguishable from nothing to find.
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
const pinFile = "apps/api/src/ruleset.ts";
// Read as a DECLARATION from the parse tree.
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
// EXACTLY ONE published ruleset is the invariant, and anything else is an ERROR here rather than a reason to stand down.
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

// THE VERSION IS SPELLED IN THREE PLACES AND ALL THREE MUST AGREE: the artifact's filename, the `ruleset_version` inside it, and the api's pin.
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

// --------------------------------------------------------------------------------------------- SPEC-CONFLICT #127 item 2: Square/POS scope agreement (governance §5 step 7).
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

    // RULE A.
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

// RULE C, second half.
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

if (unreadable.length > 0) {
  console.error("Baseline manifest marks APPROVED something that cannot be read as an artifact:\n");
  for (const f of unreadable) console.error("  ✗ " + f);
  console.error(
    "\nOnly a file carries a self-declared status. A row that reaches a directory, or a document " +
      "this cannot parse, states an approval nothing can be checked against. Fix the row or the " +
      "artifact.",
  );
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
for (const c of checked) console.log("  ✓ " + c);

if (headerless.length > 0) {
  console.warn(
    `\n${headerless.length} file(s) the manifest marks APPROVED declare no status header of ` +
      `their own, so the manifest row is their only approval record (governance §7):`,
  );
  for (const rel of headerless) console.warn("  ! " + rel);
}
