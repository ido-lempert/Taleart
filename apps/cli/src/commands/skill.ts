import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Context, GroupSpec } from '../command';
import { CliError, EXIT, usageError } from '../errors';
import { SKILL_FILES, SKILL_NAME } from '../skill-files';

/** Where `skill install` writes: the user's or the project's Claude Code skills, or a folder given. */
export function skillTarget(ctx: Pick<Context, 'opts' | 'io'>): { dir: string; scope: 'user' | 'project' | 'dir' } {
  const project = ctx.opts['project'] === true;
  const given = ctx.opts['dir'] as string | undefined;
  if (project && given !== undefined) throw usageError('Give --project or --dir, not both');
  if (given !== undefined) {
    if (given.trim() === '') throw usageError('--dir needs a folder');
    const expanded = given === '~' || given.startsWith('~/') ? join(ctx.io.home, given.slice(1)) : given;
    return { dir: join(resolve(ctx.io.cwd, expanded), SKILL_NAME), scope: 'dir' };
  }
  if (project) return { dir: join(ctx.io.cwd, '.claude', 'skills', SKILL_NAME), scope: 'project' };
  return { dir: join(ctx.io.home, '.claude', 'skills', SKILL_NAME), scope: 'user' };
}

function sameFile(path: string, content: string): boolean | null {
  if (!existsSync(path)) return null;
  if (!statSync(path).isFile()) return false;
  return readFileSync(path, 'utf8') === content;
}

export const skill: GroupSpec = {
  name: 'skill',
  summary: 'Install the TaleArt agent skill (for Claude Code and other Agent Skills agents), or print it.',
  description:
    'The CLI carries the skill that teaches an AI agent to manage TaleArt through this CLI: setup, concepts, safety rules, ' +
    'recipes and troubleshooting. Install it once for your user or for one repository.',
  commands: [
    {
      name: 'install',
      mutates: true,
      auth: false,
      result: '{ "dir": string, "scope": "user" | "project" | "dir", "files": string[], "written": string[], "unchanged": string[] }',
      summary: 'Write the skill to ~/.claude/skills/taleart, or .claude/skills/taleart with --project.',
      description:
        'Writes SKILL.md and its reference files. Files already the same are left as they are. When the folder holds different ' +
        'versions of the skill\'s files (an edited or older skill) nothing is written (exit 6) unless --force, which replaces ' +
        'only the skill\'s own files. --dir names another agent\'s skills folder; the skill goes in <dir>/taleart.',
      // Here --project is a switch (this repository's skills folder), not the global --project <id|name>:
      // the command's own option wins (parseCommand), and the command uses no TaleArt project.
      options: {
        project: { type: 'boolean', description: 'Install for this repository: .claude/skills/taleart in the current folder.' },
        dir: { type: 'string', valueName: '<path>', description: 'Install in <path>/taleart, a skills folder of another agent.' },
        force: { type: 'boolean', description: 'Replace the skill\'s files when they differ.' },
      },
      examples: [
        'taleart skill install',
        'taleart skill install --project',
        'taleart skill install --dir ~/.agents/skills --json',
        'taleart skill install --force',
      ],
      async run(ctx) {
        const { dir, scope } = skillTarget(ctx);
        const force = ctx.opts['force'] === true;
        const states = SKILL_FILES.map((f) => ({ file: f, path: join(dir, ...f.path.split('/')), same: false as boolean | null }));
        for (const s of states) s.same = sameFile(s.path, s.file.content);
        const differing = states.filter((s) => s.same === false).map((s) => s.file.path);
        if (differing.length > 0 && !force) {
          throw new CliError(
            `The skill folder ${dir} already holds other versions of ${differing.join(', ')}; nothing was written`,
            EXIT.conflict,
            'skill_exists',
            undefined,
            'Rerun with --force to replace them (other files in the folder are kept).',
          );
        }
        const written: string[] = [];
        const unchanged: string[] = [];
        for (const s of states) {
          if (s.same === true) {
            unchanged.push(s.file.path);
            continue;
          }
          mkdirSync(dirname(s.path), { recursive: true });
          writeFileSync(s.path, s.file.content);
          written.push(s.file.path);
        }
        const files = SKILL_FILES.map((f) => f.path);
        return {
          data: { dir, scope, files, written, unchanged },
          text:
            written.length === 0
              ? `The TaleArt skill in ${dir} is up to date.`
              : `Installed the TaleArt skill in ${dir} (${written.length} of ${files.length} files written). ` +
                'Start a new agent session to load it.',
        };
      },
    },
    {
      name: 'show',
      mutates: false,
      auth: false,
      result: '{ "path": string, "content": string } (with no file: { "name": string, "files": { "path": string, "bytes": number }[], "path": "SKILL.md", "content": string })',
      summary: 'Print the skill\'s SKILL.md, or one of its reference files.',
      args: [{ name: 'file', description: 'A file of the skill, such as reference/recipes.md (default SKILL.md).' }],
      examples: ['taleart skill show', 'taleart skill show reference/recipes.md', 'taleart skill show --json'],
      async run(ctx) {
        const wanted = ctx.args['file'] as string | undefined;
        const file = SKILL_FILES.find((f) => f.path === (wanted ?? 'SKILL.md') || f.path === `reference/${wanted}`);
        if (!file) {
          throw new CliError(`The skill has no file ${wanted}`, EXIT.notFound, 'not_found', undefined, `Its files: ${SKILL_FILES.map((f) => f.path).join(', ')}.`);
        }
        const data =
          wanted === undefined
            ? {
                name: SKILL_NAME,
                files: SKILL_FILES.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content) })),
                path: file.path,
                content: file.content,
              }
            : { path: file.path, content: file.content };
        return { data, text: file.content.replace(/\n$/, '') };
      },
    },
  ],
};
