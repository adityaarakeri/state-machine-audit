#!/usr/bin/env node
// Lints every skill against the Agent Skills spec basics, checks that
// referenced files exist, and blocks em dashes in markdown (house style).
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, SKILLS_DIR, listSkills, parseSkill, walk } from "./lib.mjs";

const errors = [];
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

for (const dir of listSkills()) {
  const skillPath = join(SKILLS_DIR, dir, "SKILL.md");
  if (!existsSync(skillPath)) {
    errors.push(`skills/${dir}: missing SKILL.md`);
    continue;
  }
  let parsed;
  try {
    parsed = parseSkill(skillPath);
  } catch (e) {
    errors.push(e.message);
    continue;
  }
  const { data, body } = parsed;

  if (!data.name) errors.push(`${dir}: frontmatter needs "name"`);
  else {
    if (!NAME_RE.test(data.name)) errors.push(`${dir}: name must be lowercase-hyphenated`);
    if (data.name.length > 64) errors.push(`${dir}: name is over 64 chars`);
    if (data.name !== dir) errors.push(`${dir}: name "${data.name}" must match folder name`);
  }
  if (!data.description) errors.push(`${dir}: frontmatter needs "description"`);
  else if (data.description.length > 1024) errors.push(`${dir}: description is over 1024 chars`);

  const lines = body.split("\n").length;
  if (lines > 500) errors.push(`${dir}: SKILL.md body is ${lines} lines, keep it under 500 and move detail to references/`);

  // Every `references/...` mention must resolve to a real file.
  for (const [, ref] of body.matchAll(/`((?:references|scripts|assets)\/[^`]+)`/g)) {
    if (!existsSync(join(SKILLS_DIR, dir, ref))) errors.push(`${dir}: referenced file not found: ${ref}`);
  }
}

// Every search pattern in the audit vectors must at least compile as a regex.
// JS and ripgrep syntax differ at the edges, but a pattern that fails here is
// almost certainly broken for rg too.
for (const dir of listSkills()) {
  const vectors = join(SKILLS_DIR, dir, "references", "audit-vectors.md");
  if (!existsSync(vectors)) continue;
  readFileSync(vectors, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!line.startsWith("- **")) return;
      for (const [, pat] of line.matchAll(/`([^`]+)`/g)) {
        try {
          new RegExp(pat);
        } catch (e) {
          errors.push(`${dir}/references/audit-vectors.md:${i + 1}: pattern does not compile: ${pat} (${e.message})`);
        }
      }
    });
}

// House style: no em dashes anywhere in markdown.
for (const file of walk(ROOT).filter((f) => f.endsWith(".md") || f.endsWith(".mdc"))) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (line.includes("\u2014")) errors.push(`${relative(ROOT, file)}:${i + 1}: em dash found`);
    });
}

if (errors.length) {
  console.error(`✖ ${errors.length} problem(s):\n  ` + errors.join("\n  "));
  process.exit(1);
}
console.log(`✔ ${listSkills().length} skill(s) valid`);
