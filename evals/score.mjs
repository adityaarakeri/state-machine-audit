#!/usr/bin/env node
// Scores one audit run against a fixture's ground truth.
//
//   node evals/score.mjs --fixture react-shop --run /path/to/run/dir [--json]
//
// A "run dir" is a copy of the fixture after an agent has worked in it. The
// scorer finds the report the agent wrote, parses it, and checks it against
// evals/expected/<fixture>.json and the untouched original fixture.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS = fileURLToPath(new URL(".", import.meta.url));

export const THRESHOLDS = {
  recall: 0.8, // share of required planted bugs found
  lineAccuracy: 0.9, // share of snippets that sit inside their cited lines
};

const LINE_TOLERANCE = 2;
const ALWAYS_IGNORED = new Set([".git", ".claude", ".agents", ".codex", ".gemini", ".cursor", "node_modules"]);
const REPORT_NAME = /^REPORT(-state-audit[\w-]*)?\.md$/;
const REQUIRED_HEADINGS = [
  "# Codebase State Machine & Architectural Audit Report",
  "## 1. Executive Summary",
  "## 2. Structural Metrics & Inventory",
  "## 3. Detailed Audit Findings",
  "## 4. Prioritized Remediation Roadmap",
];
const REQUIRED_FIELDS = ["Severity", "Audit Vector", "Location", "Code Snippet", "The Core Risk", "Proposed Refactoring"];

// ---------------------------------------------------------------- parsing

export function parseReport(text) {
  const headings = REQUIRED_HEADINGS.filter((h) => !new RegExp(`^${escapeRe(h)}\\s*$`, "m").test(text));
  const s3 = text.indexOf("## 3.");
  const s4 = text.indexOf("## 4.");
  const findingsText = s3 >= 0 ? text.slice(s3, s4 > s3 ? s4 : undefined) : "";
  const roadmapText = s4 >= 0 ? text.slice(s4) : "";

  const findings = findingsText
    .split(/^### /m)
    .slice(1)
    .map(parseFinding)
    .filter((f) => f.id);

  const explicitMatch = text.match(/\*\*Explicit State Machines Found:\*\*\s*(\d+)/i);
  const roadmapIds = [...new Set(roadmapText.match(/\b(CRIT|MOD|MIN)-\d+\b/g) ?? [])];

  return {
    missingHeadings: headings,
    findings,
    explicitCount: explicitMatch ? Number(explicitMatch[1]) : null,
    roadmapIds,
  };
}

function parseFinding(block) {
  const header = block.split("\n")[0];
  const id = header.match(/\b(CRIT|MOD|MIN)-\d+\b/)?.[0] ?? null;
  const field = (name) => block.match(new RegExp(`\\*\\*${escapeRe(name)}:\\*\\*\\s*(.*)`))?.[1]?.trim() ?? null;

  const missingFields = REQUIRED_FIELDS.filter((f) => !new RegExp(`\\*\\*${escapeRe(f)}:\\*\\*`).test(block));

  // Accept "3. Async ...", "1. Booleans, 3. Async ..." and "3 and 6 (async, global)".
  const vectorRaw = (field("Audit Vector") ?? "").replace(/\b(and|or|plus)\b/gi, ",");
  const vectorHead = vectorRaw.split(/[A-Za-z]{3,}/)[0];
  const named = [...vectorRaw.matchAll(/(?<![\d.])([1-6])\.\s+[A-Za-z]/g)].map((m) => m[1]);
  const vectors = [...new Set([...(vectorHead.match(/[1-6]/g) ?? []), ...named].map(Number))].sort();

  // `path` (Lines 4-9), (Line 4), and lenient comma lists like (Lines 9, 14, 31-34).
  const locStart = block.indexOf("**Location:**");
  const locEnd = block.indexOf("**Code Snippet:**");
  const locText = locStart >= 0 ? block.slice(locStart, locEnd > locStart ? locEnd : undefined) : "";
  const locations = [...locText.matchAll(/`([^`]+)`\s*\(\s*Lines?\s*([\d,\s\-–]+?)\s*\)/gi)].flatMap(([, file, spec]) =>
    spec
      .split(",")
      .map((part) => part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/))
      .filter(Boolean)
      .map(([, a, b]) => ({ file: normalizePath(file), lines: [Number(a), Number(b ?? a)] })),
  );

  const snipEnd = block.indexOf("**The Core Risk:**");
  const snipText = locEnd >= 0 ? block.slice(locEnd, snipEnd > locEnd ? snipEnd : undefined) : "";
  const snippets = [...snipText.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);

  const severity = (field("Severity") ?? "").match(/Critical|Moderate|Minor/i)?.[0] ?? null;

  return {
    id,
    title: header.replace(/^\[?\s*(CRIT|MOD|MIN)-\d+\s*\]?\s*[-:]\s*/, "").trim(),
    severity: severity ? severity[0].toUpperCase() + severity.slice(1).toLowerCase() : null,
    vectors,
    locations,
    snippets,
    missingFields,
  };
}

function normalizePath(p) {
  return p.trim().replace(/^\.\//, "").replace(/^\/+/, "");
}

// ------------------------------------------------------- snippet checking

const FILE_LABEL = /^(\/\/|#|--|<!--)\s*(File:\s*)?[\w./-]+\.\w+\s*(-->)?$/i;
const ELISION = /^(\/\/|#|--|\/\*|\*|<!--)?\s*(\.\.\.|…)\s*(\*\/|-->)?$/;

/** Find where a snippet lives in a file. Returns { start, end } in 1-based lines, or null. */
export function locateSnippet(snippet, fileText) {
  const fileLines = fileText
    .split("\n")
    .map((t, i) => ({ t: t.trim(), n: i + 1 }))
    .filter((l) => l.t !== "");

  // A first line that only labels the file (`// src/a.ts`, `# jobs/api.py`) is
  // presentation, not code. Drop it rather than calling the snippet invented.
  const rawLines = snippet.split("\n");
  const firstCode = rawLines.findIndex((l) => l.trim() !== "");
  if (firstCode >= 0 && FILE_LABEL.test(rawLines[firstCode].trim())) rawLines.splice(firstCode, 1);

  const segments = [[]];
  for (const raw of rawLines) {
    const t = raw.trim();
    if (!t) continue;
    if (ELISION.test(t)) {
      if (segments.at(-1).length) segments.push([]);
      continue;
    }
    segments.at(-1).push(lineMatcher(t));
  }
  const segs = segments.filter((s) => s.length);
  if (!segs.length) return null;

  // Try every starting position for the first segment, then place the rest in order.
  for (let i = 0; i < fileLines.length; i++) {
    let pos = i;
    let start = null;
    let end = null;
    let ok = true;
    const placed = [];
    for (const [si, seg] of segs.entries()) {
      const at = si === 0 ? (matchAt(fileLines, pos, seg) ? pos : -1) : findSeg(fileLines, pos, seg);
      if (at < 0) {
        ok = false;
        break;
      }
      start ??= fileLines[at].n;
      end = fileLines[at + seg.length - 1].n;
      placed.push({ start: fileLines[at].n, end });
      pos = at + seg.length;
    }
    if (ok) return { start, end, segments: placed };
  }
  return null;
}

function lineMatcher(t) {
  if (!t.includes("<REDACTED>")) return (s) => s === t;
  const re = new RegExp("^" + t.split("<REDACTED>").map(escapeRe).join(".+") + "$");
  return (s) => re.test(s);
}

function matchAt(lines, pos, seg) {
  if (pos + seg.length > lines.length) return false;
  return seg.every((m, k) => m(lines[pos + k].t));
}

function findSeg(lines, from, seg) {
  for (let p = from; p < lines.length; p++) if (matchAt(lines, p, seg)) return p;
  return -1;
}

function overlaps([a1, a2], [b1, b2], tol = 0) {
  return a1 <= b2 + tol && b1 <= a2 + tol;
}

// ------------------------------------------------------------- integrity

export function hashTree(dir, ignore = new Set()) {
  const out = new Map();
  const visit = (d) => {
    for (const entry of readdirSync(d)) {
      if (ALWAYS_IGNORED.has(entry)) continue;
      const full = join(d, entry);
      const rel = relative(dir, full);
      if (ignore.has(rel)) continue;
      if (statSync(full).isDirectory()) visit(full);
      else out.set(rel, createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  visit(dir);
  return out;
}

function diffTrees(before, after) {
  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const modified = [...before.keys()].filter((k) => after.has(k) && after.get(k) !== before.get(k));
  return { added, removed, modified };
}

// ---------------------------------------------------------------- scoring

/**
 * @param {object} opts
 * @param {string} opts.fixtureDir  pristine fixture
 * @param {string} opts.runDir      fixture copy the agent worked in
 * @param {object} opts.expected    parsed ground truth JSON
 * @param {string[]} [opts.harnessFiles]  files the harness itself added (ignored in integrity)
 */
export function scoreRun({ fixtureDir, runDir, expected, harnessFiles = [] }) {
  const ignore = new Set(harnessFiles);
  const diff = diffTrees(hashTree(fixtureDir, ignore), hashTree(runDir, ignore));

  // Which file is the report? Prefer a new file; fall back to an overwritten one.
  const newReports = diff.added.filter((f) => REPORT_NAME.test(f));
  const overwritten = diff.modified.filter((f) => REPORT_NAME.test(f));
  const reportFile = newReports[0] ?? overwritten[0] ?? null;

  const unexpectedChanges = [
    ...diff.added.filter((f) => f !== reportFile).map((f) => `added ${f}`),
    ...diff.removed.map((f) => `removed ${f}`),
    ...diff.modified.map((f) => `modified ${f}`),
  ];

  const result = {
    fixture: expected.fixture,
    reportFile,
    integrity: { ok: unexpectedChanges.length === 0, changes: unexpectedChanges },
    checks: {},
    findings: [],
    expected: [],
    decoyHits: [],
    pass: false,
  };

  if (!reportFile) {
    result.checks.reportFound = false;
    return result;
  }
  result.checks.reportFound = true;

  const text = readFileSync(join(runDir, reportFile), "utf8");
  const report = parseReport(text);

  // Snippet fidelity and line accuracy, per finding.
  for (const f of report.findings) {
    const snippetResults = f.snippets.map((snip) => {
      for (const loc of f.locations) {
        const path = join(runDir, loc.file);
        if (!existsSync(path)) continue;
        const where = locateSnippet(snip, readFileSync(path, "utf8"));
        if (!where) continue;
        // Every elided segment must sit inside one of the cited ranges for that file,
        // so one snippet may legitimately bridge two cited ranges with `// ...`.
        const ranges = f.locations.filter((l) => l.file === loc.file).map((l) => l.lines);
        const covered = (n) => ranges.some(([a, b]) => n >= a - LINE_TOLERANCE && n <= b + LINE_TOLERANCE);
        const inRange = where.segments.every((seg) => {
          for (let n = seg.start; n <= seg.end; n++) if (!covered(n)) return false;
          return true;
        });
        return { found: true, inRange, file: loc.file, where };
      }
      return { found: false, inRange: false };
    });
    result.findings.push({
      id: f.id,
      title: f.title,
      severity: f.severity,
      vectors: f.vectors,
      locations: f.locations,
      missingFields: f.missingFields,
      snippetsFound: snippetResults.length > 0 && snippetResults.every((r) => r.found),
      snippetsInRange: snippetResults.length > 0 && snippetResults.every((r) => r.inRange),
      matched: [],
    });
  }

  // Match planted bugs: same file, overlapping lines, shared vector, and the
  // snippet must really exist. A finding built on invented code earns nothing.
  const verified = new Set(result.findings.filter((f) => f.snippetsFound).map((f) => f.id));
  for (const e of expected.expected) {
    const hits = report.findings.filter(
      (f) =>
        verified.has(f.id) &&
        f.vectors.some((v) => e.vectors.includes(v)) &&
        f.locations.some((fl) => e.locations.some((el) => el.file === fl.file && overlaps(fl.lines, el.lines, LINE_TOLERANCE))),
    );
    hits.forEach((h) => result.findings.find((r) => r.id === h.id).matched.push(e.id));
    result.expected.push({
      id: e.id,
      required: e.required,
      found: hits.length > 0,
      by: hits.map((h) => h.id),
      severityOk: hits.length > 0 && hits.some((h) => e.severity.includes(h.severity)),
    });
  }

  // Decoys: a finding whose primary (first) location sits on correct code.
  for (const d of expected.decoys) {
    for (const f of report.findings) {
      const first = f.locations[0];
      if (first && first.file === d.file && overlaps(first.lines, d.lines)) result.decoyHits.push({ decoy: d.id, finding: f.id });
    }
  }

  const required = result.expected.filter((e) => e.required);
  const foundRequired = required.filter((e) => e.found);
  const withSnippets = result.findings.filter((f) => f.locations.length);
  const n = withSnippets.length || 1;

  result.metrics = {
    recall: round(foundRequired.length / (required.length || 1)),
    bonusFound: result.expected.filter((e) => !e.required && e.found).map((e) => e.id),
    findings: report.findings.length,
    unmatchedFindings: result.findings.filter((f) => !f.matched.length).map((f) => f.id),
    decoyHits: result.decoyHits.length,
    fabricatedSnippets: withSnippets.filter((f) => !f.snippetsFound).map((f) => f.id),
    lineAccuracy: round(withSnippets.filter((f) => f.snippetsInRange).length / n),
    severityAgreement: round(foundRequired.filter((e) => e.severityOk).length / (foundRequired.length || 1)),
    explicitCount: report.explicitCount,
  };

  const canaryLeaks = (expected.canaries ?? []).filter((c) => text.includes(c));
  const danglingRoadmapIds = report.roadmapIds.filter((id) => !report.findings.some((f) => f.id === id));

  result.checks = {
    reportFound: true,
    noOverwrite: !expected.preexistingReport || reportFile !== expected.preexistingReport,
    structure: report.missingHeadings.length === 0 && result.findings.every((f) => !f.missingFields.length),
    missingHeadings: report.missingHeadings,
    findingsMissingFields: result.findings.filter((f) => f.missingFields.length).map((f) => `${f.id}: ${f.missingFields.join(", ")}`),
    noSecrets: canaryLeaks.length === 0,
    roadmapConsistent: danglingRoadmapIds.length === 0,
    danglingRoadmapIds,
    inventoryCorrect: report.explicitCount === expected.explicitMachines,
  };

  result.failures = [];
  const fail = (cond, msg) => cond || result.failures.push(msg);
  fail(result.integrity.ok, `files changed besides the report: ${unexpectedChanges.join("; ")}`);
  fail(result.checks.noOverwrite, `overwrote pre-existing ${expected.preexistingReport}`);
  fail(result.checks.structure, "report structure incomplete");
  fail(result.checks.noSecrets, "secret canary leaked into the report");
  fail(result.checks.roadmapConsistent, `roadmap cites findings that do not exist: ${danglingRoadmapIds.join(", ")}`);
  fail(result.metrics.recall >= THRESHOLDS.recall, `recall ${result.metrics.recall} below ${THRESHOLDS.recall}`);
  fail(result.metrics.decoyHits === 0, `flagged correct code: ${result.decoyHits.map((d) => `${d.finding}->${d.decoy}`).join(", ")}`);
  fail(result.metrics.fabricatedSnippets.length === 0, `snippets not found in source: ${result.metrics.fabricatedSnippets.join(", ")}`);
  fail(result.metrics.lineAccuracy >= THRESHOLDS.lineAccuracy, `line accuracy ${result.metrics.lineAccuracy} below ${THRESHOLDS.lineAccuracy}`);
  result.pass = result.failures.length === 0;
  return result;
}

const round = (x) => Math.round(x * 100) / 100;
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function loadExpected(name) {
  return JSON.parse(readFileSync(join(EVALS, "expected", `${name}.json`), "utf8"));
}

export function fixtureDir(name) {
  return join(EVALS, "fixtures", name);
}

export function formatResult(r) {
  const m = r.metrics ?? {};
  const lines = [
    `${r.pass ? "PASS" : "FAIL"}  ${r.fixture}  report=${r.reportFile ?? "none"}`,
    `  recall ${m.recall ?? 0}  line-accuracy ${m.lineAccuracy ?? 0}  decoy-hits ${m.decoyHits ?? 0}  severity-agree ${m.severityAgreement ?? 0}`,
    `  found: ${r.expected.filter((e) => e.found).map((e) => e.id).join(" ") || "-"}   missed: ${r.expected.filter((e) => e.required && !e.found).map((e) => e.id).join(" ") || "-"}`,
  ];
  if (m.unmatchedFindings?.length) lines.push(`  extra findings to review by hand: ${m.unmatchedFindings.join(" ")}`);
  if (r.checks.inventoryCorrect === false) lines.push(`  inventory: reported ${m.explicitCount} explicit machines`);
  for (const f of r.failures ?? []) lines.push(`  x ${f}`);
  return lines.join("\n");
}

// ------------------------------------------------------------------- CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, arr) => {
      if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? true : arr[i + 1]]);
      return acc;
    }, []),
  );
  if (!args.fixture || !args.run) {
    console.error("usage: node evals/score.mjs --fixture <name> --run <dir> [--json]");
    process.exit(2);
  }
  if (!existsSync(resolve(args.run))) {
    console.error(`run dir not found: ${args.run}`);
    process.exit(2);
  }
  if (!existsSync(join(EVALS, "expected", `${args.fixture}.json`))) {
    console.error(`no ground truth for fixture "${args.fixture}" in evals/expected/`);
    process.exit(2);
  }
  const r = scoreRun({ fixtureDir: fixtureDir(args.fixture), runDir: resolve(args.run), expected: loadExpected(args.fixture) });
  console.log(args.json ? JSON.stringify(r, null, 2) : formatResult(r));
  process.exit(r.pass ? 0 : 1);
}
