# Eval results

Real runs, not projections. Each run is a fresh headless Claude Code session (v2.1.319, default model) that had never seen the fixtures or the answer key, started with only: "Use the state-machine-audit skill to audit this repository."

## History

| Date | Skill version | Runs | Pass rate | Mean recall | Decoy hits | Notes |
|---|---|---|---|---|---|---|
| 2026-11-08 | 1.1.0 draft | 4 | 2/4 | 0.92 | 2 | Baseline. Both react-shop runs filed a "this is correct" note against the upload machine; one merged a race into the boolean finding. |
| 2026-11-08 | + scoping and grouping rules | 6 | 6/6 | 0.97 | 0 | py run 1 filed the `job_label` gap under vector 2, not 5. One run counted a union-type hook as an explicit machine. |
| 2026-11-08 | + vector tie-breakers, explicit-machine edge case | 6 | 4/6, then 6/6 after scorer fixes | 1.00 | 0 | Both failures were scorer bugs, confirmed by hand: a filename label line in a snippet, and one snippet spanning two adjacent cited ranges. |
| 2026-11-08 | **1.1.0 final** (+ no snippet labels) | 6 | **6/6** | **1.00** | **0** | Untouched confirmation batch, no changes made after seeing results. |
| 2026-11-08 | 1.1.0 final, `AGENTS.md` adapter | 2 | 2/2 | 1.00 | 0 | Same agent, reading the single-file adapter instead of the skill folder. |

## What the final batch shows

- Every required planted bug found in every run (11 of 11, six times over).
- Optional bugs found too: the stuck-in-running handler (P6) and the poller that never stops (E7) in every run.
- Zero decoys flagged. The correct transition table, the correct abort-controlled search hook, the independent UI toggles, the correct `SKIP LOCKED` claim, and the independent config flags were all left alone.
- Zero invented snippets, perfect line accuracy, no secret canary leaked, no file touched except the report.
- The pre-existing `REPORT.md` in py-jobqueue was never overwritten; every run used `REPORT-state-audit.md`.
- One run found a real bug that was not planted (double submit charges twice). It was confirmed by hand and added to the answer key as optional item E8.

## What this does not show yet

- **Other agents.** Only Claude Code was run here. The Codex and Gemini presets exist in `run-eval.mjs` but haven't been exercised. Run `npm run eval:codex` and `npm run eval:gemini` before claiming they work.
- **Big repos.** Both fixtures are small (about 10 files). The scoping rules for 500+ file repos are untested by this suite.
- **Other languages.** TypeScript and Python only. The Go, Kotlin, Swift, Java and Ruby patterns compile and are reasoned through, but no fixture exercises them.
- **Sample size.** 6 runs is enough to catch systematic problems, not enough to promise 99%. Rerun after any change to the skill.
