import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
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
    // ~ is the home folder, as a shell would expand it; ~\ too on Windows, where no shell does.
    const home = given === '~' || given.startsWith('~/') || (ctx.io.platform === 'win32' && given.startsWith('~\\'));
    const expanded = home ? join(ctx.io.home, given.slice(2)) : given;
    return { dir: join(resolve(ctx.io.cwd, expanded), SKILL_NAME), scope: 'dir' };
  }
  if (project) return { dir: join(ctx.io.cwd, '.claude', 'skills', SKILL_NAME), scope: 'project' };
  return { dir: join(ctx.io.home, '.claude', 'skills', SKILL_NAME), scope: 'user' };
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (code === 'ENOTDIR') throw unsafe(`A file sits where a folder of ${path} should be`);
    throw new CliError(`Could not read ${path} (${code ?? 'unknown error'})`, EXIT.invalid, 'unsafe_path');
  }
}

function unsafe(message: string): CliError {
  return new CliError(
    `${message}; nothing was written`,
    EXIT.invalid,
    'unsafe_path',
    undefined,
    'Move it away, or install elsewhere with --dir. --force never follows a link or replaces a folder.',
  );
}

export interface SkillFileState {
  /** The path inside the skill folder. */
  path: string;
  /** Where it is written. */
  target: string;
  content: string;
  /** True when the file there is the same, false when it differs, null when there is none. */
  same: boolean | null;
}

/**
 * What each of the skill's files is now. The skill folder, the folders inside it and the files must
 * be what they look like: a symbolic link among them (which could send a write elsewhere) or a folder
 * where a file goes is refused (exit 7 `unsafe_path`), with --force too. Folders above the skill
 * folder (such as a ~/.claude kept in a dotfiles repository) may be links.
 */
export function skillFileStates(dir: string): SkillFileState[] {
  const folders = new Set<string>([dir]);
  for (const f of SKILL_FILES) {
    for (let d = dirname(join(dir, ...f.path.split('/'))); d.startsWith(dir + sep); d = dirname(d)) folders.add(d);
  }
  for (const folder of [...folders].sort()) {
    const stat = lstatOrNull(folder);
    if (stat?.isSymbolicLink()) throw unsafe(`${folder} is a symbolic link`);
    if (stat && !stat.isDirectory()) throw unsafe(`${folder} is a file where the skill needs a folder`);
  }
  return SKILL_FILES.map((f) => {
    const target = join(dir, ...f.path.split('/'));
    const stat = lstatOrNull(target);
    if (stat?.isSymbolicLink()) throw unsafe(`${target} is a symbolic link`);
    if (stat?.isDirectory()) throw unsafe(`${target} is a folder where the skill's file ${f.path} goes`);
    if (stat && !stat.isFile()) throw unsafe(`${target} is not a regular file`);
    return { path: f.path, target, content: f.content, same: stat ? readFileSync(target, 'utf8') === f.content : null };
  });
}

/**
 * Writes the file whole or not at all: a new temporary file beside it, created exclusively (`wx`, so
 * it never follows a link), then renamed over the target. A failure removes the temporary file.
 */
export function writeAtomically(target: string, content: string): void {
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temp, content, { flag: 'wx' });
    renameSync(temp, target);
  } catch (err) {
    try {
      unlinkSync(temp);
    } catch {
      // It was never created.
    }
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown error';
    throw new CliError(`Could not write ${target} (${code})`, EXIT.invalid, 'unsafe_path', undefined, 'Check the folder\'s permissions.');
  }
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
        'only the skill\'s own files. Each file is written whole (a temporary file, then renamed). A symbolic link in the ' +
        'skill folder, or a folder where a file goes, is refused (exit 7), with --force too. --dir names another agent\'s ' +
        'skills folder; the skill goes in <dir>/taleart.',
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
        const states = skillFileStates(dir);
        const differing = states.filter((s) => s.same === false).map((s) => s.path);
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
            unchanged.push(s.path);
            continue;
          }
          writeAtomically(s.target, s.content);
          written.push(s.path);
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
