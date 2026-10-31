// Checks zone data a page brings itself, with no backend (`validateZone`): the body of `GET /delivery/v1/zone`, as an
// object or as JSON text. No import from the contract, so the published declarations stand on their own.

/** What {@link validateZone} answers: `ok`, or the problems found, each as a readable line with its path. */
export type ZoneValidation = { ok: true } | { ok: false; errors: string[] };

/** The most problems one validation reports; a longer list is cut with a final line saying so. */
export const MAX_ZONE_ERRORS = 25;

const MEDIA_KINDS = ['image', 'video'];
const TAG_MATCHES = ['any', 'all'];

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'a number';
  if (typeof value === 'boolean') return 'true or false';
  return typeof value === 'object' ? 'an object' : typeof value;
}

// Collects problems for one validation.
class Problems {
  readonly list: string[] = [];
  add(path: string, problem: string): void {
    this.list.push(`${path || 'the zone'}: ${problem}`);
  }
  /** The value at `key` of `parent` when it is `kind`; otherwise adds a problem and answers undefined. */
  text(parent: Obj, key: string, path: string, required: boolean, nonEmpty = false): string | undefined {
    const value = parent[key];
    const at = path ? `${path}.${key}` : key;
    if (value === undefined) {
      if (required) this.add(at, 'is missing (it must be text)');
      return undefined;
    }
    if (typeof value !== 'string') {
      this.add(at, `must be text, but is ${describe(value)}`);
      return undefined;
    }
    if (nonEmpty && value.trim() === '') this.add(at, 'must not be empty');
    return value;
  }
  object(parent: Obj, key: string, path: string, nullable: boolean, required: boolean): Obj | null | undefined {
    const value = parent[key];
    const at = path ? `${path}.${key}` : key;
    if (value === undefined) {
      if (required) this.add(at, `is missing (it must be an object${nullable ? ' or null' : ''})`);
      return undefined;
    }
    if (value === null && nullable) return null;
    if (!isObject(value)) {
      this.add(at, `must be an object${nullable ? ' or null' : ''}, but is ${describe(value)}`);
      return undefined;
    }
    return value;
  }
  array(parent: Obj, key: string, path: string, required: boolean): unknown[] | undefined {
    const value = parent[key];
    const at = path ? `${path}.${key}` : key;
    if (value === undefined) {
      if (required) this.add(at, 'is missing (it must be a list)');
      return undefined;
    }
    if (!Array.isArray(value)) {
      this.add(at, `must be a list, but is ${describe(value)}`);
      return undefined;
    }
    return value;
  }
}

function checkMedia(p: Problems, media: Obj, path: string): void {
  const kind = p.text(media, 'kind', path, false);
  if (kind !== undefined && !MEDIA_KINDS.includes(kind)) p.add(`${path}.kind`, `must be "image" or "video", but is "${kind}"`);
  p.text(media, 'url', path, true, true);
}

function checkTale(p: Problems, tale: unknown, path: string): void {
  if (!isObject(tale)) {
    p.add(path, `must be an object, but is ${describe(tale)}`);
    return;
  }
  p.text(tale, 'id', path, true, true);
  p.text(tale, 'title', path, true);
  const media = p.object(tale, 'media', path, true, false);
  if (media) checkMedia(p, media, `${path}.media`);
  const document = p.object(tale, 'document', path, true, false);
  if (document) {
    p.object(document, 'canvas', `${path}.document`, false, false);
    const elements = p.array(document, 'elements', `${path}.document`, true);
    elements?.forEach((element, i) => {
      const at = `${path}.document.elements[${i}]`;
      if (!isObject(element)) p.add(at, `must be an object, but is ${describe(element)}`);
      else {
        p.text(element, 'id', at, true, true);
        p.text(element, 'type', at, true, true);
        p.object(element, 'props', at, false, false);
      }
    });
  }
  if (!(isObject(media) || isObject(document))) {
    p.add(path, 'needs `media` or `document`, or it has nothing to show');
  }
}

function checkGroup(p: Problems, group: unknown, path: string): void {
  if (!isObject(group)) {
    p.add(path, `must be an object, but is ${describe(group)}`);
    return;
  }
  p.text(group, 'id', path, true, true);
  p.text(group, 'name', path, true);
  const tags = p.array(group, 'tags', path, false);
  tags?.forEach((tag, i) => {
    if (typeof tag !== 'string') p.add(`${path}.tags[${i}]`, `must be text, but is ${describe(tag)}`);
  });
  const match = p.text(group, 'tagMatch', path, false);
  if (match !== undefined && !TAG_MATCHES.includes(match)) p.add(`${path}.tagMatch`, `must be "any" or "all", but is "${match}"`);
  p.object(group, 'audience', path, true, false);
  const cover = p.object(group, 'cover', path, true, false);
  if (cover) p.text(cover, 'url', `${path}.cover`, true, true);
  const tales = p.array(group, 'tales', path, true);
  tales?.forEach((tale, i) => checkTale(p, tale, `${path}.tales[${i}]`));
}

// Reads text as JSON; the problem line when it is not JSON.
function parse(json: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(json) as unknown };
  } catch (err) {
    return { error: `is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
}

export function problemsOf(input: unknown): { value: unknown; errors: string[] } {
  let value = input;
  if (typeof input === 'string') {
    const parsed = parse(input);
    if ('error' in parsed) return { value: undefined, errors: [`the zone ${parsed.error}`] };
    value = parsed.value;
  }
  const p = new Problems();
  if (!isObject(value)) {
    p.add('', `must be a JSON object (the body of GET /delivery/v1/zone), but is ${describe(value)}`);
  } else {
    p.text(value, 'id', '', false);
    p.text(value, 'name', '', false);
    p.text(value, 'slug', '', false);
    p.object(value, 'theme', '', false, false);
    const frame = p.object(value, 'frame', '', true, true);
    if (frame) {
      p.text(frame, 'type', 'frame', true, true);
      p.object(frame, 'settings', 'frame', false, false);
    }
    const groups = p.array(value, 'taleGroups', '', true);
    groups?.forEach((group, i) => checkGroup(p, group, `taleGroups[${i}]`));
    const ids = new Set<string>();
    groups?.forEach((group, i) => {
      const id = isObject(group) ? group['id'] : undefined;
      if (typeof id !== 'string') return;
      if (ids.has(id)) p.add(`taleGroups[${i}].id`, `"${id}" is used by an earlier group; every group needs its own id`);
      ids.add(id);
    });
  }
  const errors =
    p.list.length > MAX_ZONE_ERRORS
      ? [...p.list.slice(0, MAX_ZONE_ERRORS), `…and ${p.list.length - MAX_ZONE_ERRORS} more problems`]
      : p.list;
  return { value, errors };
}

/**
 * Checks zone data (the body of `GET /delivery/v1/zone`, as an object or as JSON text) the way the SDK reads it:
 * `{ ok: true }` when it can be shown, otherwise `{ ok: false, errors }` with one line per problem, each naming
 * the path, such as `taleGroups[1].tales[0].media.url: is missing (it must be text)`. Fields the SDK does not
 * need (a missing `theme`, `slug` or `tags`) are not errors. Nothing is shown or sent.
 */
export function validateZone(json: unknown): ZoneValidation {
  const { errors } = problemsOf(json);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

