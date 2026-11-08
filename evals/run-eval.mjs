#!/usr/bin/env node
// Runs the skill with a real coding agent against every fixture, N times each,
// and scores the results.
//
//   node evals/run-eval.mjs --agent claude --runs 3
//   node evals/run-eval.mjs --agent codex --fixtures py-jobqueue
//   node evals/run-eval.mjs --cmd 'my-agent --prompt {prompt}'
//
// Each run gets a fresh temp copy of the fixture with the skill installed the
// way that agent expects, plus a git repo so the skill's `git status` check works.
// Results land in evals/results/<timestamp>/.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureDir, formatResult, loadExpected, scoreRun } from "./score.mjs";

const EVALS = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(EVALS, "..");
const SKILL = "state-machine-audit";

// Headless commands per agent. CLI flags move fast; if one of these stops
// working with your version, pass --cmd with the right invocation.
const AGENTS = {
  claude: {
    install: (dir) => [copySkill(dir, ".claude/skills")],
    prompt: `Use the ${SKILL} skill to audit this repository.`,
    cmd: `claude -p {prompt} --allowedTools "Read,Grep,Glob,Write,Bash(git status:*),Bash(rg:*),Bash(ls:*)"`,
  },
  codex: {
    install: (dir) => [copySkill(dir, ".agents/skills")],
    prompt: `Use the ${SKILL} skill to audit this repository.`,
    cmd: `codex exec --sandbox workspace-write {prompt}`,
  },
  gemini: {
    needsDist: true,
    install: (dir) => [copyAdapter(dir, "GEMINI.md")],
    prompt: `Follow the "Skill: ${SKILL}" section in GEMINI.md to audit this repository.`,
    cmd: `gemini -p {prompt}`,
  },
  agentsmd: {
    needsDist: true,
    install: (dir) => [copyAdapter(dir, "AGENTS.md")],
    prompt: `Follow the "Skill: ${SKILL}" section in AGENTS.md to audit this repository.`,
    cmd: null,
  },
};

const args = parseArgs(process.argv.slice(2));
const agentName = args.agent ?? "claude";
const agent = AGENTS[agentName];
if (!agent) die(`unknown --agent ${agentName}. Options: ${Object.keys(AGENTS).join(", ")}`);
const cmdTemplate = args.cmd ?? agent.cmd;
if (!cmdTemplate) die(`--agent ${agentName} has no default command; pass --cmd '... {prompt}'`);
const runs = Number(args.runs ?? 1);
const timeoutMin = Number(args.timeout ?? 20);
const fixtures = (args.fixtures ?? readdirSync(join(EVALS, "fixtures")).join(",")).split(",");

if (agent.needsDist && !existsSync(join(ROOT, "dist"))) {
  console.log("building adapters first...");
  spawnSync("node", [join(ROOT, "scripts/build.mjs")], { stdio: "inherit" });
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(EVALS, "results", `${stamp}-${agentName}`);
mkdirSync(outDir, { recursive: true });

const all = [];
for (const name of fixtures) {
  const expected = loadExpected(name);
  for (let i = 1; i <= runs; i++) {
    const runDir = mkdtempSync(join(tmpdir(), `sma-${name}-`));
    cpSync(fixtureDir(name), runDir, { recursive: true });
    const harnessFiles = agent.install(runDir).filter(Boolean);
    git(runDir, ["init", "-q"]);
    git(runDir, ["add", "-A"]);
    git(runDir, ["-c", "user.email=eval@local", "-c", "user.name=eval", "commit", "-qm", "fixture"]);

    const cmd = cmdTemplate.replace("{prompt}", shellQuote(agent.prompt));
    console.log(`\n[${name} run ${i}/${runs}] ${cmd}\n  in ${runDir}`);
    const started = Date.now();
    const proc = spawnSync(cmd, {
      cwd: runDir,
      shell: true,
      encoding: "utf8",
      timeout: timeoutMin * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    writeFileSync(join(outDir, `${name}-run${i}.log`), `${proc.stdout ?? ""}\n--- stderr ---\n${proc.stderr ?? ""}`);
    if (proc.error) console.log(`  agent error: ${proc.error.message}`);

    const result = scoreRun({ fixtureDir: fixtureDir(name), runDir, expected, harnessFiles });
    result.run = i;
    result.seconds = seconds;
    result.runDir = runDir;
    all.push(result);
    writeFileSync(join(outDir, `${name}-run${i}.json`), JSON.stringify(result, null, 2));
    console.log(formatResult(result) + `\n  (${seconds}s, files kept in ${runDir})`);
  }
}

// Summary across runs: pass rate plus mean and worst-case recall per fixture.
const summary = fixtures.map((name) => {
  const rs = all.filter((r) => r.fixture === name);
  const recalls = rs.map((r) => r.metrics?.recall ?? 0);
  return {
    fixture: name,
    runs: rs.length,
    passRate: `${rs.filter((r) => r.pass).length}/${rs.length}`,
    meanRecall: +(recalls.reduce((a, b) => a + b, 0) / (recalls.length || 1)).toFixed(2),
    minRecall: Math.min(...recalls),
    decoyHits: rs.reduce((a, r) => a + (r.metrics?.decoyHits ?? 0), 0),
  };
});
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log("\n=== summary ===");
console.table(summary);
console.log(`results: ${outDir}`);
process.exit(all.every((r) => r.pass) ? 0 : 1);

// ---------------------------------------------------------------- helpers

function copySkill(runDir, rel) {
  cpSync(join(ROOT, "skills", SKILL), join(runDir, rel, SKILL), { recursive: true });
  return null; // dot-dirs are ignored by the integrity check already
}

function copyAdapter(runDir, file) {
  cpSync(join(ROOT, "dist", file), join(runDir, file));
  return file;
}

function git(cwd, a) {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  if (r.status !== 0) die(`git ${a.join(" ")} failed: ${r.stderr}`);
}

function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith("--") ? (i++, next) : true;
  }
  return out;
}

function die(msg) {
  console.error(msg);
  process.exit(2);
}
