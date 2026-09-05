import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "skills");

export function listSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, "SKILL.md")))
    .map(entry => entry.name)
    .sort();
}

export function loadSkills(names = []) {
  const available = new Set(listSkills());
  return names.map(name => {
    if (!available.has(name)) throw new Error(`Unknown skill: ${name}`);
    return {
      name,
      content: readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8").trim()
    };
  });
}

export function buildPrompt(prompt, skillNames = []) {
  const selected = loadSkills(skillNames);
  if (!selected.length) return prompt.trim();
  const skillText = selected.map(skill => `## Skill: ${skill.name}\n${skill.content}`).join("\n\n");
  return `${skillText}\n\n## User request\n${prompt.trim()}`;
}

export function autoSelectSkills(prompt) {
  const text = String(prompt).toLowerCase();
  const available = new Set(listSkills());
  const selected = [];
  for (const [name, words] of [["concise", ["短く", "concise", "brief"]], ["coding", ["code", "コード", "実装", "bug"]], ["research", ["research", "調査", "調べ"]]]) {
    if (available.has(name) && words.some(word => text.includes(word))) selected.push(name);
  }
  return selected;
}
