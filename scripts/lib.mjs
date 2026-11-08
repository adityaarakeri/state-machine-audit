// Shared helpers for build, validate and eval scripts. Zero dependencies on
// purpose, so the repo works with a bare Node install.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SKILLS_DIR = join(ROOT, "skills");

/**
 * Minimal YAML frontmatter reader. Supports what SKILL.md files actually use:
 * scalar keys, quoted strings, folded (>) and literal (|) block scalars, and
 * one level of nested maps (for `metadata:`). Anything fancier should fail
 * loudly rather than be misread, so unknown shapes throw.
 */
export function parseFrontmatter(yaml, path = "frontmatter") {
  const lines = yaml.split(/\r?\n/);
  const data = {};
  let i = 0;

  const readBlock = (style, baseIndent) => {
    const chunk = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "") {
        chunk.push("");
        i++;
        continue;
      }
      if (indentOf(l) <= baseIndent) break;
      chunk.push(l.trim());
      i++;
    }
    while (chunk.length && chunk.at(-1) === "") chunk.pop();
    return style.startsWith(">")
      ? chunk.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ")
      : chunk.join("\n");
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) throw new Error(`${path}: cannot parse frontmatter line ${i + 1}: "${line}"`);
    const [, key, rawValue] = m;
    i++;
    if (/^[>|][-+]?$/.test(rawValue)) {
      data[key] = readBlock(rawValue, 0);
    } else if (rawValue === "") {
      const map = {};
      while (i < lines.length && (lines[i].trim() === "" || indentOf(lines[i]) > 0)) {
        const nl = lines[i];
        i++;
        if (!nl.trim()) continue;
        const nm = nl.match(/^\s+([\w-]+):\s*(.*)$/);
        if (!nm) throw new Error(`${path}: cannot parse nested line "${nl}"`);
        map[nm[1]] = /^[>|][-+]?$/.test(nm[2]) ? readBlock(nm[2], indentOf(nl)) : scalar(nm[2]);
      }
      data[key] = map;
    } else {
      data[key] = scalar(rawValue);
    }
  }
  return data;
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function scalar(v) {
  v = v.trim();
  if (v.startsWith('"') && v.endsWith('"')) return JSON.parse(v);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** Split a SKILL.md into { data, body }. */
export function parseSkill(path) {
  const raw = readFileSync(path, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`${path}: missing YAML frontmatter`);
  return { data: parseFrontmatter(match[1], path), body: match[2].trim() };
}

/** Render a value as a YAML scalar that is always safe (JSON strings are valid YAML). */
export function yamlString(value) {
  return JSON.stringify(String(value));
}

export function listSkills() {
  return readdirSync(SKILLS_DIR).filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory());
}

/** Recursively list files under dir, skipping noise directories. */
export function walk(dir, skip = ["node_modules", ".git", "dist"]) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (skip.includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, skip));
    else out.push(full);
  }
  return out;
}
