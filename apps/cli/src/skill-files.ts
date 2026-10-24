// The TaleArt agent skill (epic developer experience 10.4), bundled into the CLI build as text so
// `taleart skill install` writes it without the repository. The source is the skills/taleart folder;
// skill.spec.ts checks this list against it, byte for byte, so a new reference file cannot be left out.
import concepts from '@taleart/agent-skill/reference/concepts.md?raw';
import recipes from '@taleart/agent-skill/reference/recipes.md?raw';
import setup from '@taleart/agent-skill/reference/setup.md?raw';
import troubleshooting from '@taleart/agent-skill/reference/troubleshooting.md?raw';
import skill from '@taleart/agent-skill/SKILL.md?raw';

export interface SkillFile {
  /** The path inside the skill folder, with forward slashes. */
  path: string;
  content: string;
}

/** The skill's folder name, which is also its `name` in SKILL.md's frontmatter. */
export const SKILL_NAME = 'taleart';

export const SKILL_FILES: readonly SkillFile[] = [
  { path: 'SKILL.md', content: skill },
  { path: 'reference/setup.md', content: setup },
  { path: 'reference/concepts.md', content: concepts },
  { path: 'reference/recipes.md', content: recipes },
  { path: 'reference/troubleshooting.md', content: troubleshooting },
];
