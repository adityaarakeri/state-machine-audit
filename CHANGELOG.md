# Changelog

All notable changes to this project are written down here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [SemVer](https://semver.org/).

## [1.1.0] - 2026-11-08

### Added
- Eval suite in `evals/`: two fixture repos (TypeScript/React storefront, Python job queue) with planted bugs, decoys, secret canaries and a pre-existing `REPORT.md`; ground truth kept outside the fixtures; a scorer; and a runner that drives Claude Code, Codex, Gemini CLI or any custom command headlessly.
- Scorer tests with a golden report that must pass and a bad report that must fail for specific reasons (`npm test`).
- Worked example finding in the report template, showing the expected depth.
- Search patterns for Kotlin, Java, C#, Swift, Go and ORMs, plus "logged then ignored" error patterns.
- Validator checks that every documented search pattern compiles.
- `evals/RESULTS.md` recording every eval batch, including failures and what the numbers do not cover.
- `--agent`, `--uninstall` options for the installer.
- On-demand CI job for real-model evals.

### Fixed
- Search recipes piped one `rg` into another, which produced line numbers from the pipe instead of the source file. Removed, and the skill now requires reading line numbers from the opened file.
- The skill could overwrite an existing `REPORT.md`. It now falls back to `REPORT-state-audit.md`.
- ripgrep with no path argument waits on stdin in agent shells and hangs. Every pattern now says to pass a path.
- The Python boolean pattern missed `obj.is_x = True` and dataclass fields.
- Copilot prompt files now use the `agent:` frontmatter key instead of the undocumented `mode:`.
- Generated frontmatter values are quoted, so a colon in a description no longer breaks Cursor or Copilot adapters.
- The frontmatter parser handles folded and literal block scalars and quoted strings, and fails loudly on anything it can't read.
- Project installs no longer write to both `.claude/skills` and `.agents/skills` by default, which made some agents list the skill twice.
- Pattern tables used `|` inside regex, which broke the markdown tables. Converted to lists.

### Changed (driven by real eval runs)
- Correct code never gets a finding, not even a Minor one; praise goes in the summary. Baseline runs kept filing "this is well built, but..." notes against correct code.
- Different defects in the same code are separate findings; the same defect in many places is one finding. Baseline runs merged a race into a boolean-flag finding.
- Tie-breakers for vectors 2, 3, 4 and 5, and a stricter definition of "explicit state machine" (a union type with inline setters does not count).
- Out-of-scope issues such as committed credentials get one sentence in the summary instead of a forced finding.
- No file-name labels or added comments inside snippets.

### Changed
- Secrets in snippets must be replaced with `<REDACTED>`.
- Vendored, generated and build output is excluded from the audit.
- "Explicit state machine" is now defined, so inventory counts are consistent.
- A finding can list several locations.

## [1.0.0] - 2026-11-08

### Added
- `state-machine-audit` skill in Agent Skills format (`SKILL.md` plus `references/`).
- Reference files: audit vectors, severity rubric, REPORT.md template.
- Build script generating Cursor, Copilot, AGENTS.md and GEMINI.md adapters plus a plain prompt.
- Validator for frontmatter, broken reference links and em dashes.
- Install script with a `--link` dev mode.
- GitHub Actions CI.
