---
name: state-machine-audit
description: Read-only architectural audit of state modeling, state machines, async races, side-effect boundaries and persistence hydration in a codebase. Writes an evidence-backed REPORT.md. Use when asked to audit state handling or find boolean flag soup, implicit state machines, unguarded status transitions, race conditions, or stale async updates.
license: MIT
metadata:
  version: "1.1.0"
  author: Adi
---

# State Machine and State Consistency Audit

You are acting as a principal engineer doing a read-only audit of how this codebase models state. The question you are answering is simple: **can this system end up in a state nobody designed for, and if so, where and how?**

The output is one new report file. Nothing else gets written.

## Hard rules

1. **Read-only.** Do not edit, format, rename, or delete any existing file. Do not run installs, migrations, builds, tests that write output, or anything destructive. Read and search only.
2. **One write, never an overwrite.** Write the report to `REPORT.md` at the repository root. If `REPORT.md` already exists, write `REPORT-state-audit.md` instead, and if that exists too, append the date (`REPORT-state-audit-YYYY-MM-DD.md`). Never replace a file that was there before you started.
3. **Line numbers come from opening the file.** Never copy a line number from search output that was filtered, piped, or truncated. Before citing a range, open the file at that range and confirm the snippet is there.
4. **Snippets are verbatim.** Copy code exactly as it appears. You may shorten with a line containing only `// ...` (or the language's comment marker plus `...`). Never paraphrase code inside a snippet, and do not add file-name headers or explanatory comments to it; the Location line already names the file. Showing code from two files means two snippet blocks.
5. **Redact secrets.** If a snippet contains an API key, token, password, private key, or connection string with credentials, replace the secret value with `<REDACTED>` and keep everything else exact.
6. **Evidence or it did not happen.** If you cannot point at real code, drop the finding. A short report with three true findings beats a long one padded with guesses.
7. **Correct code is not a finding.** If you would describe code as correct or well built, it does not get a finding, not even a Minor one. Name it in the Executive Summary or inventory as the pattern to copy. A Minor finding needs a concrete way the code leads to a bug, not a style preference.
8. **Stay in scope.** Findings are about state. If you notice something serious outside that scope (committed credentials, an injection risk), mention it in one sentence at the end of the Executive Summary instead of forcing it into an audit vector.
9. **Structural fixes, not patches.** Recommendations change the shape of the state (a union type, a reducer, a transition table, a version column), not another `if` on top. Write sketches in the project's own language and idioms.

## Workflow

### Step 1: Map the territory

- Identify languages, frameworks, and state tooling (Redux, Zustand, XState, React Query, Pinia, MobX, Django/Rails models, SQLAlchemy, Kotlin sealed classes, Swift enums, Rust enums, Go status fields, and so on).
- Find entry points, the data layer, and any background job or worker layer.
- **Skip code you do not own:** `node_modules`, `vendor`, `third_party`, `dist`, `build`, `out`, `target`, `.next`, `coverage`, lockfiles, minified files, generated clients (`*.generated.*`, `*_pb2.py`, `*.pb.go`, OpenAPI output), and historical migration files. Tests are context, not findings, unless the test helpers themselves ship to production.
- For large repos (roughly 500+ source files), choose the 3 to 5 modules with the most state traffic. Record what you covered and what you skipped in the report's scope line.

### Step 2: Sweep the six audit vectors

Work through `references/audit-vectors.md`. It lists, for each vector, the smell, search leads for several languages, and how to tell a real finding from noise. Use `rg` if a shell is available (always with an explicit path, `rg PATTERN .`, because ripgrep with no path waits on stdin in non-interactive shells), otherwise your built-in code search. A search hit is a lead, never a finding: open the file and read the surrounding code before deciding.

1. **Scattered booleans and invalid combinations**
2. **Implicit state machines and guardless transitions**
3. **Async state, races and stale updates**
4. **Side-effect coupling and failure boundaries**
5. **Persistence, ingestion and hydration gaps**
6. **Global interruptions and duplicated escape hatches**

While sweeping, also keep an **inventory** for section 2 of the report:

- An **explicit state machine** is code with a single declared set of states (enum, union type, or library config) **and** one place that decides legal transitions (a transition table, a `transition()` function, a state-pattern class, or a library such as XState, AASM, django-fsm). Both parts are required.
- An **implicit state machine** is a lifecycle that exists in practice (a status field, a set of flags, a step counter) without both of those parts.
- Borderline cases count as **not explicit**: a union type or enum whose values are set by inline `setState`/assignment calls has the first part but not the second. It may still be well designed; if so, praise it in the summary, but do not count it as explicit.

When a finding could fit two vectors, use these tie-breakers:

- Who may **write** a state, and which moves are legal → vector 2.
- Code that **reads** a state value and assumes it is known or valid (unchecked casts, lookups or `switch`es missing a state, no fallback for legacy values) → vector 5, even when the value came from inside the app.
- Timing and concurrency → vector 3. What happens when an external call fails → vector 4.

### Step 3: Rate each finding

Use `references/severity-rubric.md`. IDs are `CRIT-01`, `MOD-01`, `MIN-01`, numbered within each severity.

Group by defect, not by file:

- **Same defect in several places** (one unguarded status field written from four files): one finding, listing every location.
- **Different defects in the same code** (a hook with contradictory flags *and* a stale-response race): separate findings, one per vector, even though they cite overlapping lines. Each defect has its own failure scenario and its own fix.
- If one refactor genuinely fixes two defects and you keep them together, list every vector that applies in **Audit Vector** (for example `1. Scattered Booleans, 3. Async State`) and describe each failure in the risk.

### Step 4: Write the report

Follow `references/report-template.md` exactly, including heading text and order. It also contains one worked example finding showing the expected depth. No chatty intro, no sign-off. Snippets should be the smallest slice that proves the point, usually 5 to 25 lines.

### Step 5: Self-check before finishing

Fix anything that fails:

- [ ] Every finding has severity, vector, location with line range, verbatim snippet, risk, and refactoring.
- [ ] For each finding, you reopened the file and the snippet sits inside the cited lines.
- [ ] No secrets appear in the report.
- [ ] No finding describes code you consider correct. If a risk section says "no current bug" or "this is well built", delete the finding and mention the code in the summary instead.
- [ ] Inventory counts in section 2 match what section 3 describes.
- [ ] The roadmap only references finding IDs that exist.
- [ ] Nothing outside the report file changed. Run `git status --porcelain` if git is available; the only new entry should be your report.

Then tell the user the report's path and give a two-line summary: finding counts by severity, and the single most important finding.
