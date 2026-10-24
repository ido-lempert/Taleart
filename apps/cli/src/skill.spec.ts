// The TaleArt agent skill (epic developer experience 10.4): every command and flag it, and the docs'
// "AI agents" page, tells an agent to run is one this CLI has; the bundled copy is the skills/taleart
// folder byte for byte; `taleart skill install` and `taleart skill show` work.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { GLOBAL_OPTIONS, locate, parseCommand } from './args';
import { run } from './cli';
import { GROUPS, TOP_COMMANDS } from './commands';
import { CliError, EXIT } from './errors';
import { help } from './help';
import { SKILL_FILES, SKILL_NAME } from './skill-files';
import { fakeIo } from './testing';

function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('nx.json not found above ' + process.cwd());
    dir = up;
  }
  return dir;
}

const root = workspaceRoot();
const skillDir = join(root, 'skills', SKILL_NAME);
/** The docs' "AI agents" page and its example session, which show commands too. */
const DOCS_FILES = ['apps/docs/src/app/pages/ai-agents.ts', 'apps/docs/src/app/agent-session.ts'];

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [relative(skillDir, path).split('\\').join('/')];
  });
}

/** A command line split as a shell would (quotes kept together), placeholders such as `<tale id>` as one word. */
function words(line: string): string[] {
  const out: string[] = [];
  const re = /<[^<>]+>|"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const m of line.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3] ?? m[0]);
  return out;
}

/** Each `taleart …` command in a shell line: cut at pipes, `&&`, `;`, redirections and comments. */
function commandsIn(line: string): string[] {
  const code = line.replace(/^\s*\$\s+/, '').replace(/\s#\s.*$/, '');
  return code
    .split(/\s*(?:\|\||&&|\||;|\$\()\s*/)
    .map((part) => part.replace(/\s[<>]\s.*$/, '').replace(/\)\s*$/, '').trim())
    .filter((part) => /^taleart(\s|$)/.test(part));
}

interface Mention {
  file: string;
  command: string;
  /** In running text (an inline code span): its required arguments and options may be left out. */
  partial: boolean;
}

/** The commands in a Markdown file: every line of a fenced block, and inline code spans. */
function markdownMentions(file: string, text: string): { commands: Mention[]; flags: string[] } {
  const commands: Mention[] = [];
  const flags: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      for (const command of commandsIn(line)) commands.push({ file, command, partial: false });
      continue;
    }
    for (const [, span] of line.matchAll(/`([^`]+)`/g)) {
      for (const command of commandsIn(span)) commands.push({ file, command, partial: true });
      if (/^--?[a-z]/.test(span)) flags.push(span.split(/[\s=]/)[0]);
    }
  }
  return { commands, flags };
}

const decode = (text: string) =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The commands on the docs page: `<code>` elements and the session's `$ ` lines. */
function docsMentions(file: string, text: string): Mention[] {
  const mentions: Mention[] = [];
  for (const [, code] of text.matchAll(/<code>([^<]*)<\/code>/g)) {
    // A one-line <code> in running text may leave arguments out; a block (several lines) may not.
    const lines = decode(code).split('\n');
    for (const line of lines) for (const command of commandsIn(line)) mentions.push({ file, command, partial: lines.length === 1 });
  }
  for (const line of text.split('\n')) {
    const at = line.indexOf('$ taleart ');
    if (at >= 0) for (const command of commandsIn(decode(line.slice(at)))) mentions.push({ file, command, partial: false });
  }
  return mentions;
}

/** Why the CLI would refuse the command, or null when it parses. */
function refusal({ command, partial }: Mention): string | null {
  const argv = words(command).slice(1);
  try {
    if (argv[0] === 'help') {
      // `taleart help <group> <command>` names a form, not a topic: check the words that are not placeholders.
      const topic = argv.slice(1).filter((w) => !w.startsWith('-'));
      if (topic.some((w) => w.startsWith('<'))) return topic.every((w) => w.startsWith('<')) ? null : 'a topic mixed with placeholders';
      help(topic, argv.includes('--json'));
      return null;
    }
    // Only global flags, such as `taleart --version --json`.
    if (argv.length > 0 && argv.every((w) => w.startsWith('-'))) {
      const unknown = argv.filter((w) => !Object.keys(GLOBAL_OPTIONS).some((name) => w === `--${name}` || w === `-${GLOBAL_OPTIONS[name].short}`));
      return unknown.length === 0 ? null : `unknown flags ${unknown.join(' ')}`;
    }
    const located = locate(argv, GROUPS, TOP_COMMANDS);
    if (located.unknown !== undefined || (!located.command && !partial)) return 'no such command';
    if (!located.command) return null;
    if (argv.includes('--version') && argv.length === 1) return null;
    const parsed = parseCommand(located.command, located.rest);
    if (parsed.globals.yes && !located.command.destructive) return '--yes on a command that is not destructive';
    return null;
  } catch (err) {
    if (partial && err instanceof CliError && /^(Missing|Give )/.test(err.message)) return null;
    return err instanceof Error ? err.message : String(err);
  }
}

const skillTexts = SKILL_FILES.map((f) => ({ path: f.path, text: readFileSync(join(skillDir, f.path), 'utf8') }));
const skillMentions = skillTexts.map((f) => markdownMentions(`skills/taleart/${f.path}`, f.text));
const docsFileMentions = DOCS_FILES.map((f) => docsMentions(f, readFileSync(join(root, f), 'utf8')));
const allMentions = [...skillMentions.flatMap((m) => m.commands), ...docsFileMentions.flat()];
const allFlags = new Set([
  ...Object.entries(GLOBAL_OPTIONS).flatMap(([name, spec]) => [`--${name}`, ...(spec.short ? [`-${spec.short}`] : [])]),
  ...[...TOP_COMMANDS, ...GROUPS.flatMap((g) => g.commands)].flatMap((c) =>
    Object.entries(c.options ?? {}).flatMap(([name, spec]) => [`--${name}`, ...(spec.short ? [`-${spec.short}`] : [])]),
  ),
]);

describe('the skill names only commands and flags the CLI has', () => {
  it('finds the commands in the skill and on the docs page', () => {
    expect(skillMentions.flatMap((m) => m.commands).filter((m) => !m.partial).length).toBeGreaterThan(40);
    for (const mentions of docsFileMentions) expect(mentions.length).toBeGreaterThan(3);
  });

  it('every command parses with the CLI\'s own parser', () => {
    const refused = allMentions.map((m) => [m.file, m.command, refusal(m)]).filter(([, , why]) => why !== null);
    expect(refused).toEqual([]);
  });

  it('every flag mentioned on its own exists', () => {
    const unknown = skillMentions.flatMap((m) => m.flags).filter((flag) => !allFlags.has(flag));
    expect(unknown).toEqual([]);
  });

  it('the check catches a made-up command, a made-up flag and --yes on a safe command', () => {
    const fails = (command: string, partial = false) => refusal({ file: 'probe', command, partial }) !== null;
    expect(fails('taleart zones remove home-top --json')).toBe(true);
    expect(fails('taleart groups on Summer --live --json')).toBe(true);
    expect(fails('taleart groups on Summer --yes --json')).toBe(true);
    expect(fails('taleart groups create --zone home-top --json')).toBe(true);
    expect(fails('taleart help nonsense')).toBe(true);
    expect(fails('taleart groups on', true)).toBe(false);
    expect(fails('taleart site-keys rotate --project "Shop" --yes --json')).toBe(false);
    expect(commandsIn('SITE_KEY=$(taleart site-keys issue --json | jq -r .key)')).toEqual(['taleart site-keys issue --json']);
    expect(commandsIn('taleart login --url https://x --token-stdin < token.txt')).toEqual(['taleart login --url https://x --token-stdin']);
  });

  it('names every destructive command in the operating rules', () => {
    const skill = skillTexts[0].text;
    const destructive = GROUPS.flatMap((g) => g.commands.filter((c) => c.destructive).map((c) => `${g.name} ${c.name}`));
    expect(destructive.length).toBeGreaterThan(3);
    for (const command of destructive) expect(skill).toContain(command);
  });

  it('never tells an agent to pass the token on the command line', () => {
    const tokenFlag = allMentions.filter((m) => /\s--token(\s|=|$)/.test(m.command));
    expect(tokenFlag).toEqual([]);
    for (const { text } of skillTexts) expect(text).not.toMatch(/tat_[A-Za-z0-9_-]{7,}/);
  });
});

describe('the skill package', () => {
  it('bundles the skills/taleart folder byte for byte, every file of it', () => {
    expect(SKILL_FILES.map((f) => f.path).sort()).toEqual(filesUnder(skillDir).sort());
    for (const f of SKILL_FILES) expect(f.content).toBe(readFileSync(join(skillDir, f.path), 'utf8'));
  });

  it('has the Agent Skills frontmatter: name taleart and a third-person description of when to use it', () => {
    const skill = skillTexts[0].text;
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';
    const field = (key: string) => new RegExp(`^${key}: (.+)$`, 'm').exec(front)?.[1];
    expect(field('name')).toBe('taleart');
    const description = field('description') ?? '';
    expect(description.length).toBeGreaterThan(80);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).toMatch(/^Manages TaleArt/);
    expect(description).toContain('Use when');
    expect(description).not.toMatch(/\b(I|you|your)\b/i);
    // A plain YAML scalar: no ": " that would start a mapping.
    expect(description).not.toContain(': ');
  });

  it('keeps SKILL.md short and links every reference file', () => {
    const skill = skillTexts[0].text;
    expect(skill.split('\n').length).toBeLessThanOrEqual(200);
    for (const f of SKILL_FILES.slice(1)) expect(skill).toContain(`](${f.path})`);
    for (const { text } of skillTexts) {
      for (const [, link] of text.matchAll(/\]\(([^)#]+\.md)(#[^)]*)?\)/g)) {
        expect(existsSync(join(skillDir, ...(link.startsWith('reference/') ? [link] : ['reference', link])))).toBe(true);
      }
    }
  });
});

describe('taleart skill install', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'taleart-skill-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const io = () => fakeIo(undefined, { home: join(dir, 'home'), cwd: join(dir, 'repo'), env: { TALEART_CONFIG_DIR: join(dir, 'config') } });
  const installed = (folder: string) => SKILL_FILES.map((f) => readFileSync(join(folder, f.path), 'utf8'));

  it('writes the skill for the user in ~/.claude/skills/taleart, with no URL or token', async () => {
    const one = io();
    expect(await run(['skill', 'install', '--json'], one)).toBe(EXIT.ok);
    const target = join(dir, 'home', '.claude', 'skills', 'taleart');
    expect(JSON.parse(one.stdoutText)).toEqual({
      dir: target,
      scope: 'user',
      files: SKILL_FILES.map((f) => f.path),
      written: SKILL_FILES.map((f) => f.path),
      unchanged: [],
    });
    expect(one.stderrText).toBe('');
    expect(installed(target)).toEqual(SKILL_FILES.map((f) => f.content));
    expect(one.calls).toEqual([]);
  });

  it('writes it for the repository with --project, and leaves the same files as they are', async () => {
    expect(await run(['skill', 'install', '--project'], io())).toBe(EXIT.ok);
    const target = join(dir, 'repo', '.claude', 'skills', 'taleart');
    expect(installed(target)).toEqual(SKILL_FILES.map((f) => f.content));
    const again = io();
    expect(await run(['skill', 'install', '--project', '--json'], again)).toBe(EXIT.ok);
    expect(JSON.parse(again.stdoutText)).toMatchObject({ scope: 'project', written: [], unchanged: SKILL_FILES.map((f) => f.path) });
    const text = io();
    await run(['skill', 'install', '--project'], text);
    expect(text.stdoutText).toContain('is up to date');
  });

  it('writes it in <dir>/taleart with --dir, ~ for the home folder', async () => {
    expect(await run(['skill', 'install', '--dir', '~/.agents/skills'], io())).toBe(EXIT.ok);
    expect(installed(join(dir, 'home', '.agents', 'skills', 'taleart'))).toEqual(SKILL_FILES.map((f) => f.content));
    expect(await run(['skill', 'install', '--dir', 'tools/skills'], io())).toBe(EXIT.ok);
    expect(existsSync(join(dir, 'repo', 'tools', 'skills', 'taleart', 'SKILL.md'))).toBe(true);
  });

  it('stops with exit 6 when the folder holds other versions, and --force replaces only the skill\'s files', async () => {
    const target = join(dir, 'home', '.claude', 'skills', 'taleart');
    mkdirSync(join(target, 'reference'), { recursive: true });
    writeFileSync(join(target, 'SKILL.md'), 'edited by hand\n');
    writeFileSync(join(target, 'notes.md'), 'mine\n');
    const refused = io();
    expect(await run(['skill', 'install', '--json'], refused)).toBe(EXIT.conflict);
    expect(refused.stdoutText).toBe('');
    expect(JSON.parse(refused.stderrText)).toMatchObject({ error: { code: 'skill_exists', exitCode: 6, hint: expect.stringContaining('--force') } });
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('edited by hand\n');
    expect(existsSync(join(target, 'reference', 'setup.md'))).toBe(false);

    const forced = io();
    expect(await run(['skill', 'install', '--force', '--json'], forced)).toBe(EXIT.ok);
    expect(JSON.parse(forced.stdoutText).written).toEqual(SKILL_FILES.map((f) => f.path));
    expect(installed(target)).toEqual(SKILL_FILES.map((f) => f.content));
    expect(readFileSync(join(target, 'notes.md'), 'utf8')).toBe('mine\n');
  });

  it('refuses --project with --dir', async () => {
    const both = io();
    expect(await run(['skill', 'install', '--project', '--dir', 'x', '--json'], both)).toBe(EXIT.usage);
    expect(existsSync(join(dir, 'repo'))).toBe(false);
  });
});

describe('taleart skill show', () => {
  it('prints SKILL.md, or a reference file by its path or its name', async () => {
    const plain = fakeIo();
    expect(await run(['skill', 'show'], plain)).toBe(EXIT.ok);
    expect(plain.stdoutText).toBe(SKILL_FILES[0].content);
    for (const ref of ['reference/recipes.md', 'recipes.md']) {
      const one = fakeIo();
      expect(await run(['skill', 'show', ref, '--json'], one)).toBe(EXIT.ok);
      expect(JSON.parse(one.stdoutText)).toEqual({ path: 'reference/recipes.md', content: readFileSync(join(skillDir, 'reference/recipes.md'), 'utf8') });
    }
    const all = fakeIo();
    await run(['skill', 'show', '--json'], all);
    expect(JSON.parse(all.stdoutText)).toMatchObject({ name: 'taleart', path: 'SKILL.md', files: SKILL_FILES.map((f) => ({ path: f.path, bytes: expect.any(Number) })) });
  });

  it('answers exit 5 for a file the skill does not have', async () => {
    const none = fakeIo();
    expect(await run(['skill', 'show', 'secrets.md', '--json'], none)).toBe(EXIT.notFound);
    expect(JSON.parse(none.stderrText)).toMatchObject({ error: { code: 'not_found', hint: expect.stringContaining('SKILL.md') } });
  });
});
