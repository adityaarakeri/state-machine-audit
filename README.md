# state-machine-audit

A skill you drop into your coding agent that reads through a codebase, hunts for the ways its state can go sideways, and writes up what it found in `REPORT.md`. It never touches your code.

Works with Claude Code, OpenAI Codex, Gemini CLI, Cursor, GitHub Copilot, and anything else that reads the Agent Skills format. For tools that don't, `npm run build` spits out a version they can use.

## What it actually checks

Six things, roughly in order of how often they bite:

1. **Boolean soup.** `isLoading`, `isError`, `isSuccess` all living side by side, so nothing stops two of them being true at once.
2. **Status fields anyone can overwrite.** A `status` string that five different files write to, with no rule about which moves are legal.
3. **Late async writes.** A request that comes back after the user already left the page, and stomps on newer data.
4. **Side effects tangled into transitions.** The order gets marked paid, then the charge fails, and nothing undoes the first step.
5. **Unchecked hydration.** A status read from the database or localStorage and trusted blindly, until someone renames a state and old rows break things.
6. **Copy-pasted global handling.** Every module has its own `if 401 then logout`, and they've all drifted apart.

Each finding in the report comes with the file, the line numbers, the actual code, what can go wrong, and a sketch of a structural fix.

## Quick start

You need Node 18 or newer, plus bash for the installer.

```bash
git clone https://github.com/adityaarakeri/state-machine-audit.git
cd state-machine-audit
npm run check            # validate + build adapters
npm run install:user     # install for every project on this machine
```

Then open any repo in your agent and say something like:

> Run the state-machine-audit skill on this repo.

You'll get `REPORT.md` in the repo root.

If you'd rather install with the community Skills CLI, use:

```bash
npx skills add adityaarakeri/state-machine-audit
```

## Installing per agent

| Agent | What it reads | How to install |
|---|---|---|
| Claude Code | `~/.claude/skills/` or `.claude/skills/` | `bash scripts/install.sh --agent claude` (add `--project` for one repo) |
| OpenAI Codex | `~/.agents/skills/` or `.agents/skills/` | `bash scripts/install.sh --agent codex` |
| Cursor | `.claude/skills/` in the project, or a rule file | `bash scripts/install.sh --project --agent cursor`, or copy `dist/cursor/.cursor/` into your repo |
| Gemini CLI | skills or `GEMINI.md` | copy `dist/GEMINI.md` into the repo root |
| GitHub Copilot | `.github/prompts/*.prompt.md` | copy `dist/copilot/.github/` into your repo, then run `/state-machine-audit` in chat |
| Windsurf, Amp, others | `AGENTS.md` | copy `dist/AGENTS.md` into the repo root |
| Anything with a chat box | nothing special | paste `dist/prompt/state-machine-audit.md` |

With no `--agent`, a user-level install writes to both `~/.claude/skills` and `~/.agents/skills`. A project install writes only to `.claude/skills`, because some editors scan both folders inside a repo and would show the skill twice.

Folder locations keep shifting as these tools evolve. If your agent can't find the skill, check its docs for where it looks, then point the installer there:

```bash
SKILL_TARGETS="$HOME/.some-agent/skills" bash scripts/install.sh
npm run uninstall    # removes what the installer added
```

## How this works (the concepts, explained)

### What a "skill" is

Think of a skill like a laminated recipe card you tape inside a kitchen cabinet. The cook (your agent) doesn't memorize every recipe. It glances at the labels on all the cards, and only pulls one out and reads it fully when someone orders that dish.

Technically a skill is just a folder with a `SKILL.md` file in it. The top of that file has a small YAML block with a `name` and a `description`. The description is the label on the card. Agents read every skill's description at startup, which is cheap, and only load the full instructions when your request matches.

That "read the label first, open the card later" trick is called **progressive disclosure**. It's why you can have dozens of skills installed without eating your context window.

### Why there's a `references/` folder

The recipe card analogy goes one step further. A good recipe card says "for the sauce, see card 12" instead of cramming everything onto one card. `SKILL.md` here is the short main card: the rules and the workflow. The detailed stuff (search patterns per language, the severity table, the report layout) lives in `references/`, and the agent only opens those when it reaches that step.

This keeps the main file small enough that agents follow it reliably. Long instruction files tend to get skimmed, by models and by people.

### Why there's a build step

Not every tool reads skill folders yet. Some only understand a single file in a specific spot: Cursor wants `.mdc` rules, Copilot wants `.prompt.md` files, a lot of CLIs read `AGENTS.md`.

The build script is like a travel adapter for a power plug. Same electricity, different plug shape. It takes the one real source (`skills/`), inlines the reference files so nothing points at a missing path, and writes out each format into `dist/`. You only ever edit `skills/`. Anything in `dist/` gets overwritten on the next build.

### Why "read-only" is a hard rule

An audit that edits code isn't an audit anymore, it's an unreviewed refactor. The skill is told it may write exactly one file, `REPORT.md`, and its last step is to check `git status` to prove nothing else changed. If you want fixes, read the report, pick findings, and ask for them separately.

## Repo layout

```
skills/
  state-machine-audit/
    SKILL.md                    the skill itself (source of truth)
    references/
      audit-vectors.md          what to look for + search patterns per language
      severity-rubric.md        how to rate findings
      report-template.md        exact report structure + one worked example
evals/
  fixtures/                     small repos with planted bugs and decoys
  expected/                     the answer key, kept outside the fixtures
  score.mjs                     scores one run
  run-eval.mjs                  runs a real agent and scores every run
  test/                         tests for the scorer (golden + bad report)
scripts/
  validate.mjs                  lint frontmatter, refs, patterns, em dashes
  build.mjs                     generate dist/ adapters
  install.sh                    copy or symlink into agent skill folders
  lib.mjs                       shared helpers, no dependencies
dist/                           generated, gitignored
```

## Local development

```bash
npm run dev      # symlink skills into your agent folders so edits show up live
npm run check    # lint + scorer tests + build; run after every change
npm run eval:claude   # the real test: run the skill against the fixtures
```

There are zero npm dependencies. Clone it and it runs.

The validator checks that:

- `name` is lowercase with hyphens, at most 64 characters, and matches the folder name
- `description` exists and stays under 1024 characters
- `SKILL.md` stays under 500 lines
- every `references/...` path mentioned in a skill actually exists
- every documented search pattern compiles
- no markdown file contains an em dash (house style)

## How you know it works: evals

Linting proves the files are well formed. It doesn't prove an agent following them writes a good report. That takes code where you already know the answers.

Think of how airport security tests a scanner. They pack test bags with known items in known places, run them through, and count what got caught. They also send clean bags to make sure it doesn't flag a phone charger. `evals/fixtures/` holds those test bags:

- **Planted bugs** at known lines, one or more per audit vector
- **Decoys** that look suspicious but are correct code (flagging one is a false positive)
- **Canary secrets** that must never show up in a report
- **A pre-existing `REPORT.md`** that must not be overwritten

Every run gets scored on recall, decoy hits, invented snippets, line accuracy, file integrity, structure and secret leaks. A finding only counts if its snippet really exists in the source, so a confident-sounding but invented finding earns nothing. Details and thresholds are in [evals/README.md](evals/README.md).

```bash
npm run eval:claude      # or eval:codex, eval:gemini, or --cmd for anything else
```

Run each fixture several times. Models aren't deterministic, and a skill that passes 2 runs out of 3 is not done.

### Current results

Measured with headless Claude Code, starting cold with only "use the state-machine-audit skill":

| Fixture | Runs | Pass | Required bugs found | Decoys flagged | Invented snippets |
|---|---|---|---|---|---|
| react-shop (TypeScript) | 3 | 3/3 | 6/6 every run | 0 | 0 |
| py-jobqueue (Python) | 3 | 3/3 | 5/5 every run | 0 | 0 |
| both, via `AGENTS.md` adapter | 2 | 2/2 | all | 0 | 0 |

The first version of the skill passed 2 of 4. The failures traced back to real gaps in the instructions (praise filed as a finding, two defects merged into one) and to a couple of scorer bugs, all fixed. The full history, and what these numbers don't prove yet (other agents, big repos, other languages), are in [evals/RESULTS.md](evals/RESULTS.md).

### Adding another skill

Make a new folder under `skills/` with its own `SKILL.md`. The installer, build and validator pick it up automatically. Add fixtures and an `expected/` file for it too, otherwise you're guessing.

## Changes from the original prompt

The skill started life as a single prompt. The main changes:

- The output spec had a code block nested inside another code block, which breaks rendering and confuses models about where the template ends. The template now lives in its own file, with a worked example.
- Line numbers must come from opening the file, never from search output.
- It writes a new report file and never overwrites an existing one.
- Secrets in snippets get redacted.
- Vendored and generated code is skipped, and "explicit state machine" is defined so inventory counts mean something.
- A severity rubric, one finding per root cause, and a self-check step at the end.

## License

MIT. See [LICENSE](LICENSE).
