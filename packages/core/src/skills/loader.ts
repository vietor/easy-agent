import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tryReadFileText } from "../util/fs.js";

import type { Skill } from "./types.js";

function parseSkillFile(skillName: string, skillFile: string): Skill | undefined {
  const content = tryReadFileText(skillFile);
  if (!content) return undefined;

  const frontMatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
  const match = content.match(frontMatterRegex);

  let name = null;
  let description = "";
  let prompt = content;

  if (match) {
    const yamlBody = match[1];
    prompt = content.replace(match[0], "").trim();

    const nameMatch = yamlBody.match(/^name:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim();

    const descMatch = yamlBody.match(/^description:\s*(.+)$/m);
    if (descMatch) description = descMatch[1].trim();
  }

  if (!name) {
    name = skillName;
  }

  return { name, description, prompt };
}

export function tryLoadSkills(path: string): Skill[] | undefined {
  if (!existsSync(path)) return undefined;

  const skills: Skill[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(path, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const skill = parseSkillFile(entry.name, skillFile);
    if (skill && skill.prompt) skills.push(skill);
  }

  return skills.length > 0 ? skills : undefined;
}
