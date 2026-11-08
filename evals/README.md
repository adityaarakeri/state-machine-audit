# Evals

This folder answers one question: **does the skill actually find bugs, without making things up?**

Linting tells you the skill files are well formed. It says nothing about whether an agent following them writes a good report. For that you need code where you already know the answers.

## The idea, with an analogy

Think of how airport security tests its scanners. They don't wait for a real threat to see whether the machine works. They pack test bags with known items hidden in known places, run them through, and count what the scanner caught and what it missed. They also send through clean bags to make sure it doesn't flag a laptop charger as a weapon.

The fixtures here are those test bags:

- **Planted bugs** are the hidden items. Each one is a real state bug, placed at known lines.
- **Decoys** are the clean bags. They look suspicious at a glance (three booleans side by side, a status field) but the code is actually correct. Flagging one is a false positive.
- **Canaries** are fake secrets sitting in the code. If one shows up in a report, redaction failed.
- **A pre-existing `REPORT.md`** sits in one fixture. If the agent overwrites it, the no-overwrite rule failed.

## Layout

```
evals/
  fixtures/<name>/        code the agent audits (never contains answers)
  expected/<name>.json    ground truth, kept outside the fixture on purpose
  score.mjs               scores one run
  run-eval.mjs            runs an agent N times per fixture and scores each run
  test/                   tests for the scorer itself, with a golden and a bad report
  results/                run output (gitignored)
```

The answer key lives in `expected/`, not inside the fixture, because the agent can read every file in the folder it's auditing. An answer key inside the exam room isn't an exam.

## Running

```bash
npm run eval:claude                      # Claude Code, 3 runs per fixture
npm run eval:codex                       # Codex CLI
npm run eval:gemini                      # Gemini CLI, via the GEMINI.md adapter
npm run eval -- --agent claude --runs 5 --fixtures py-jobqueue
npm run eval -- --cmd 'my-agent run {prompt}'   # anything else
```

Each run copies the fixture to a temp folder, installs the skill the way that agent expects, makes it a git repo, runs the agent headlessly, and scores the result. Temp folders are kept so you can open the report and look.

The headless flags for each CLI live at the top of `run-eval.mjs`. These tools change their flags often. If a preset breaks on your version, pass `--cmd`.

To score something by hand:

```bash
npm run score -- --fixture react-shop --run /path/to/the/run/folder
```

## What gets scored

| Check | Meaning | Pass if |
|---|---|---|
| Recall | Share of required planted bugs found. A match needs the right file, overlapping lines, the right audit vector, and a snippet that really exists in the code. | at least 0.8 |
| Decoy hits | Findings whose main location is correct code | 0 |
| Fabricated snippets | Snippets that don't exist anywhere in the cited file | 0 |
| Line accuracy | Share of findings whose snippet sits inside the cited lines (2 lines of slack) | at least 0.9 |
| Integrity | No file changed except the new report | true |
| No overwrite | Pre-existing `REPORT.md` left alone | true |
| Structure | All headings and finding fields present, roadmap only cites real IDs | true |
| No secrets | No canary string in the report | true |

Reported but not pass/fail: severity agreement, bonus (optional) bugs found, the explicit-machine count, and findings that matched nothing. Unmatched findings aren't automatically wrong. The agent may have spotted something real that isn't in the answer key, so read them and add them to `expected/` if they hold up.

**Run more than once.** Models are not deterministic. A skill that passes 1 run out of 3 is a coin flip, not a pass. Look at the pass rate and the worst-case recall, not just the average.

## Adding a fixture

1. Make `fixtures/<name>/` with a small, realistic codebase. 10 to 20 files is plenty.
2. Plant 4 to 7 bugs across different vectors. Make them realistic. A comment saying `// race condition here` is not a test.
3. Add 2 or 3 decoys that pattern-match as suspicious but are correct.
4. Put a canary like `EVALCANARY-something` in a secret-looking constant.
5. Write `expected/<name>.json`. Copy the shape of an existing one. Use generous line ranges that cover the whole bug.
6. Check your line numbers with `cat -n`. Then write a quick golden report by hand and score it. If your own correct report fails, the ground truth is wrong.

Good next fixtures: a Go service with a status column, a Kotlin or Swift app with a sealed class or enum misused, a Rails model with callbacks.
