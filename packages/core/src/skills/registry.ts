import type { Skill } from "./types.js";

export interface SkillSchema {
  name: string;
  description: string;
}

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  constructor(skills: Skill[] = []) {
    for (const s of skills) this.skills.set(s.name, s);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  schemas(): SkillSchema[] {
    return [...this.skills.values()].map((s) => ({
      name: s.name,
      description: s.description ?? s.name,
    }));
  }
}
