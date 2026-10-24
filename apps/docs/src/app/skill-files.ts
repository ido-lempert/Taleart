// The TaleArt agent skill's files (skills/taleart, epic developer experience 10.4), as text: the
// "AI agents" page shows them, prerendered. Each file is imported as text (the import attribute
// `loader: text`); the build copies the folder to /skill/taleart/ for download.
import concepts from '@taleart/agent-skill/reference/concepts.md' with { loader: 'text' };
import recipes from '@taleart/agent-skill/reference/recipes.md' with { loader: 'text' };
import setup from '@taleart/agent-skill/reference/setup.md' with { loader: 'text' };
import troubleshooting from '@taleart/agent-skill/reference/troubleshooting.md' with { loader: 'text' };
import skill from '@taleart/agent-skill/SKILL.md' with { loader: 'text' };

export interface SkillFile {
  /** The path inside the skill folder. */
  path: string;
  /** What the file is for. */
  about: string;
  content: string;
}

/** Where the docs serve the skill's files for download. */
export const SKILL_DOWNLOAD_BASE = '/skill/taleart/';

export const SKILL_FILES: readonly SkillFile[] = [
  { path: 'SKILL.md', about: 'when to use it, the operating rules, exit codes and the main recipe', content: skill },
  { path: 'reference/setup.md', about: 'getting the CLI, the token, the project', content: setup },
  { path: 'reference/concepts.md', about: 'the TaleArt terms and when a zone shows a group', content: concepts },
  { path: 'reference/recipes.md', about: 'exact commands for common tasks', content: recipes },
  { path: 'reference/troubleshooting.md', about: 'by exit code and by visibility reason', content: troubleshooting },
];
