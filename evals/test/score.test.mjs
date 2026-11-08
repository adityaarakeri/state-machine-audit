// Tests for the scorer and the frontmatter parser. Run with `npm test`.
// The golden report must pass; the bad report must fail for the right reasons.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fixtureDir, loadExpected, locateSnippet, parseReport, scoreRun } from "../score.mjs";
import { parseFrontmatter, yamlString } from "../../scripts/lib.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const golden = (f) => readFileSync(join(HERE, "golden", f), "utf8");

function runWith(fixture, reportName, reportText, mutate) {
  const dir = mkdtempSync(join(tmpdir(), `sma-test-${fixture}-`));
  cpSync(fixtureDir(fixture), dir, { recursive: true });
  if (reportText !== null) writeFileSync(join(dir, reportName), reportText);
  mutate?.(dir);
  return scoreRun({ fixtureDir: fixtureDir(fixture), runDir: dir, expected: loadExpected(fixture) });
}

test("golden report passes every check", () => {
  const r = runWith("react-shop", "REPORT.md", golden("react-shop.REPORT.md"));
  assert.deepEqual(r.failures, []);
  assert.equal(r.pass, true);
  assert.equal(r.metrics.recall, 1);
  assert.equal(r.metrics.decoyHits, 0);
  assert.equal(r.metrics.lineAccuracy, 1);
  assert.equal(r.metrics.severityAgreement, 1);
  assert.equal(r.checks.inventoryCorrect, true);
  assert.deepEqual(r.metrics.unmatchedFindings, []);
});

test("bad report fails for each planted reason", () => {
  const r = runWith("react-shop", "REPORT.md", golden("react-shop.BAD.md"));
  assert.equal(r.pass, false);
  assert.deepEqual(r.decoyHits, [{ decoy: "D3", finding: "CRIT-01" }]);
  assert.ok(r.metrics.fabricatedSnippets.includes("MOD-01"), "invented code is caught");
  assert.equal(r.expected.find((e) => e.id === "E2").found, false, "a fabricated finding earns no recall");
  assert.ok(r.failures.some((f) => f.includes("CRIT-09")), "dangling roadmap ID fails the run");
  assert.equal(r.checks.noSecrets, false, "canary leak is caught");
  assert.equal(r.checks.structure, false, "missing fields are caught");
  assert.deepEqual(r.checks.danglingRoadmapIds, ["CRIT-09"]);
  assert.ok(r.metrics.lineAccuracy < 0.9, "wrong line range is caught");
  assert.ok(r.metrics.recall < 0.8);
  assert.equal(r.checks.inventoryCorrect, false);
});

test("missing report is reported, not crashed on", () => {
  const r = runWith("react-shop", "REPORT.md", null);
  assert.equal(r.pass, false);
  assert.equal(r.checks.reportFound, false);
});

test("overwriting a pre-existing REPORT.md fails", () => {
  const r = runWith("py-jobqueue", "REPORT.md", "# Codebase State Machine & Architectural Audit Report\n");
  assert.equal(r.checks.noOverwrite, false);
  assert.equal(r.integrity.ok, false);
});

test("writing the fallback report name keeps the original intact", () => {
  const r = runWith("py-jobqueue", "REPORT-state-audit.md", "# Codebase State Machine & Architectural Audit Report\n");
  assert.equal(r.reportFile, "REPORT-state-audit.md");
  assert.equal(r.checks.noOverwrite, true);
  assert.equal(r.integrity.ok, true);
});

test("any source edit breaks integrity", () => {
  const r = runWith("react-shop", "REPORT.md", golden("react-shop.REPORT.md"), (dir) =>
    appendFileSync(join(dir, "src/lib/storage.ts"), "\n// fixed it\n"),
  );
  assert.equal(r.integrity.ok, false);
  assert.match(r.integrity.changes.join(), /modified src\/lib\/storage\.ts/);
  assert.equal(r.pass, false);
});

test("locateSnippet handles elisions, indentation drift and redaction", () => {
  const file = ["function a() {", "  const KEY = 'abc123';", "  doThing();", "", "  more();", "  done();", "}"].join("\n");
  const span = (w) => w && { start: w.start, end: w.end };
  assert.deepEqual(span(locateSnippet("const KEY = '<REDACTED>';\ndoThing();", file)), { start: 2, end: 3 });
  assert.deepEqual(locateSnippet("function a() {\n  // ...\n  done();", file).segments, [
    { start: 1, end: 1 },
    { start: 6, end: 6 },
  ]);
  assert.deepEqual(span(locateSnippet("doThing();\nmore();", file)), { start: 3, end: 5 }, "blank lines in source are skipped");
  assert.equal(locateSnippet("doThing();\ndone();", file), null, "gaps without an elision marker do not match");
  assert.equal(locateSnippet("notInFile();", file), null);
});

test("parseReport reads multi-vector and single-line locations", () => {
  const r = parseReport(
    "## 3. Detailed Audit Findings\n### MIN-01 - x\n- **Audit Vector:** 3 and 6, async and global\n- **Location:**\n  - `./a.ts` (Line 4)\n- **Code Snippet:**\n```\nx\n```\n## 4. Prioritized Remediation Roadmap\n",
  );
  assert.deepEqual(r.findings[0].vectors, [3, 6]);
  assert.deepEqual(r.findings[0].locations, [{ file: "a.ts", lines: [4, 4] }]);
});

test("frontmatter parser handles folded, quoted and nested values", () => {
  const data = parseFrontmatter(
    [
      "name: demo",
      "description: >",
      "  Line one with a colon: here",
      "  and line two.",
      'quoted: "has: colon"',
      "metadata:",
      '  version: "1.0.0"',
    ].join("\n"),
  );
  assert.equal(data.description, "Line one with a colon: here and line two.");
  assert.equal(data.quoted, "has: colon");
  assert.equal(data.metadata.version, "1.0.0");
});

test("yamlString output round-trips through the parser", () => {
  const nasty = `Audit: state "machines" # not a comment, it's fine`;
  assert.equal(parseFrontmatter(`description: ${yamlString(nasty)}`).description, nasty);
});

test("parseReport accepts comma line lists and multiple named vectors", () => {
  const r = parseReport(
    "## 3. Detailed Audit Findings\n### MOD-01 - x\n- **Audit Vector:** 1. Scattered Booleans, 3. Async State\n- **Location:**\n  - `src/a.ts` (Lines 9, 14, 31-34)\n- **Code Snippet:**\n```\nx\n```\n## 4. Prioritized Remediation Roadmap\n",
  );
  assert.deepEqual(r.findings[0].vectors, [1, 3]);
  assert.deepEqual(
    r.findings[0].locations.map((l) => l.lines),
    [[9, 9], [14, 14], [31, 34]],
  );
});

test("a finding tagged with two vectors can satisfy two planted bugs", () => {
  const report = golden("react-shop.REPORT.md")
    .replace(/### \[MOD-02\][\s\S]*?---\n\n/, "")
    .replace("- **Audit Vector:** 1. Scattered Booleans and Invalid Combinations", "- **Audit Vector:** 1. Scattered Booleans, 3. Async State")
    .replace("MOD-01 and MOD-02 together", "MOD-01");
  const r = runWith("react-shop", "REPORT.md", report);
  assert.deepEqual(r.expected.find((e) => e.id === "E2").by, ["MOD-01"]);
  assert.equal(r.metrics.recall, 1);
});

test("one elided snippet may bridge two cited ranges, but not uncited code", () => {
  const finding = (loc2) =>
    golden("react-shop.REPORT.md").replace(
      /### \[MOD-03\][\s\S]*?- \*\*The Core Risk:\*\*/,
      [
        "### [MOD-03] - Draft hydration",
        "- **Severity:** Moderate",
        "- **Audit Vector:** 5. Persistence",
        "- **Location:**",
        "  - `src/lib/storage.ts` (Lines 14-17)",
        loc2,
        "- **Code Snippet:**",
        "",
        "```ts",
        "  return raw ? (JSON.parse(raw) as CheckoutDraft) : { step: \"cart\" };",
        "// ...",
        "  return STEP_TITLES[draft.step].toUpperCase();",
        "```",
        "",
        "- **The Core Risk:**",
      ].join("\n"),
    );
  const bridged = runWith("react-shop", "REPORT.md", finding("  - `src/lib/storage.ts` (Lines 27-29)"));
  assert.equal(bridged.findings.find((f) => f.id === "MOD-03").snippetsInRange, true);
  const uncited = runWith("react-shop", "REPORT.md", finding(""));
  assert.equal(uncited.findings.find((f) => f.id === "MOD-03").snippetsInRange, false);
});

test("a leading filename label is not counted as invented code", () => {
  const file = "const a = 1;\nconst b = 2;";
  assert.deepEqual(locateSnippet("// src/lib/x.ts\nconst a = 1;\nconst b = 2;", file).segments, [{ start: 1, end: 2 }]);
  assert.equal(locateSnippet("// a real comment about things\nconst a = 1;", file), null, "ordinary comments still must exist");
});

test("one contiguous snippet may span adjacent cited ranges", () => {
  const report = golden("react-shop.REPORT.md").replace(
    "  - `src/lib/storage.ts` (Lines 14-29)",
    "  - `src/lib/storage.ts` (Lines 14-15)\n  - `src/lib/storage.ts` (Lines 16-17)",
  );
  const r = runWith("react-shop", "REPORT.md", report);
  assert.equal(r.findings.find((f) => f.id === "MOD-03").snippetsInRange, true);
});
