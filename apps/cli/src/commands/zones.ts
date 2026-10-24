import {
  installSnippet,
  testPageLink,
  ZONE_TEMPLATES,
  type CreateZoneRequest,
  type Frame,
  type FrameType,
  type InstallInfo,
  type SetFrameRequest,
  type UpdateFrameRequest,
  type UpdateZoneRequest,
  type Zone,
} from '@taleart/contract/core';
import type { GroupSpec } from '../command';
import { CliError, EXIT, usageError } from '../errors';
import { table } from '../output';
import { resolveZone, seg } from '../resolve';
import { visible, zoneText } from './format';

const zoneArg = { name: 'zone', description: 'The zone\'s id or slug.', required: true };

/**
 * `key=value` settings: `true`/`false` as booleans, numbers as numbers, `{…}`/`[…]` as JSON, the
 * rest as text (`aspectRatio=3:1`). The display type's JSON Schema has the last word (400
 * `invalid_frame_settings`).
 */
export function parseSettings(pairs: readonly string[], jsonText: string | undefined): Record<string, unknown> {
  let settings: Record<string, unknown> = {};
  if (jsonText !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw usageError('--settings must be a JSON object');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw usageError('--settings must be a JSON object');
    settings = { ...(parsed as Record<string, unknown>) };
  }
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw usageError(`--set takes key=value (got ${pair})`);
    settings[pair.slice(0, eq).trim()] = settingValue(pair.slice(eq + 1));
  }
  return settings;
}

function settingValue(raw: string): unknown {
  const text = raw.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (/^[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return raw;
    }
  }
  return raw;
}

export const zones: GroupSpec = {
  name: 'zones',
  summary: 'Create zones, set their display (bar or banner), slug and install snippet.',
  description:
    'A zone is a place on the site: a host page names it by its slug in <taleart-view zone="…">. ' +
    'It shows the tale groups placed in it through its display, a bar or a banner.',
  commands: [
    {
      name: 'list',
      mutates: false,
      result: 'Zone[]',
      summary: 'List zones: the project\'s, or every zone the token reaches when no project is chosen.',
      project: 'optional',
      examples: ['taleart zones list', 'taleart zones list --project Shop --json'],
      async run(ctx) {
        const projectId = await ctx.projectIdOrNull();
        const all = await ctx.client().get<Zone[]>('/zones');
        const list = projectId ? all.filter((z) => z.projectId === projectId) : all;
        return {
          data: list,
          text: table(
            list,
            [
              { label: 'id', value: (z) => z.id },
              { label: 'slug', value: (z) => z.slug },
              { label: 'name', value: (z) => z.name },
              { label: 'display', value: (z) => z.frame?.type ?? null },
              { label: 'visible', value: (z) => visible(z.visibility) },
              ...(projectId ? [] : [{ label: 'project', value: (z: Zone) => z.projectId }]),
            ],
            'No zones.',
          ),
        };
      },
    },
    {
      name: 'get',
      mutates: false,
      result: 'Zone',
      summary: 'Show one zone with its display and visibility.',
      project: 'optional',
      args: [zoneArg],
      examples: ['taleart zones get home-top', 'taleart zones get home-top --json'],
      async run(ctx) {
        const zone = await resolveZone(ctx.client(), ctx.args['zone'] as string, await ctx.projectIdOrNull());
        return { data: zone, text: zoneText(zone) };
      },
    },
    {
      name: 'create',
      mutates: true,
      result: 'Zone',
      summary: 'Create a zone, optionally from a template that sets its display.',
      project: 'required',
      options: {
        name: { type: 'string', required: true, valueName: '<name>', description: 'The zone\'s name.' },
        slug: { type: 'string', valueName: '<slug>', description: 'Lowercase letters, digits and hyphens (default: made from the name).' },
        template: {
          type: 'string',
          valueName: '<key>',
          choices: ZONE_TEMPLATES.map((t) => t.key),
          description: `A template: ${ZONE_TEMPLATES.map((t) => `${t.key} (${t.description.replace(/\.$/, '')})`).join('; ')}.`,
        },
      },
      examples: ['taleart zones create --name "Home top" --slug home-top', 'taleart zones create --name Promo --template promo-banner'],
      async run(ctx) {
        const body: CreateZoneRequest = {
          name: ctx.opts['name'] as string,
          projectId: await ctx.projectId(),
          ...(typeof ctx.opts['slug'] === 'string' && { slug: ctx.opts['slug'] }),
          ...(typeof ctx.opts['template'] === 'string' && { template: ctx.opts['template'] as CreateZoneRequest['template'] }),
        };
        const zone = await ctx.client().post<Zone>('/zones', body);
        return { data: zone, text: zoneText(zone) };
      },
    },
    {
      name: 'update',
      mutates: true,
      result: 'Zone',
      summary: 'Rename a zone or change its slug (a page names the zone by its slug).',
      description:
        'A new slug is destructive: every page that names the zone by its old slug stops showing it, so --slug needs ' +
        '--yes (or a "yes" at a terminal), and the zone must be named by its exact id or slug. A rename alone needs neither.',
      destructive: true,
      project: 'optional',
      args: [zoneArg],
      options: {
        name: { type: 'string', valueName: '<name>', description: 'The new name.' },
        slug: { type: 'string', valueName: '<slug>', description: 'The new slug.' },
      },
      examples: ['taleart zones update home-top --slug homepage-top --yes', 'taleart zones update home-top --name "Home, top"'],
      async run(ctx) {
        const body: UpdateZoneRequest = {
          ...(typeof ctx.opts['name'] === 'string' && { name: ctx.opts['name'] }),
          ...(typeof ctx.opts['slug'] === 'string' && { slug: ctx.opts['slug'] }),
        };
        if (Object.keys(body).length === 0) throw usageError('Give --name, --slug or both');
        const client = ctx.client();
        const zone = await resolveZone(client, ctx.args['zone'] as string, await ctx.projectIdOrNull(), ctx.exact);
        if (body.slug !== undefined && body.slug !== zone.slug) {
          await ctx.confirm(`Change the slug of zone ${zone.name} from ${zone.slug} to ${body.slug}? Pages that say zone="${zone.slug}" stop showing it.`);
        }
        const updated = await client.patch<Zone>(`/zones/${seg(zone.id)}`, body);
        return { data: updated, text: zoneText(updated) };
      },
    },
    {
      name: 'display',
      mutates: true,
      result: 'Frame',
      summary: 'Set a zone\'s display: its type (bar or banner) and settings.',
      description:
        'Gives the zone a display, or changes it. With the same type, --set and --settings change only the settings named ' +
        '(the rest are kept); a new --type starts from that type\'s defaults, and --set or --settings change only what they ' +
        'name. --set reads true and false as booleans and numbers as numbers: a text value that looks like one (such as ' +
        '"8") needs --settings \'{"key":"8"}\'. See `taleart zones display-types` for each type\'s settings. Prints the display (Frame).',
      project: 'optional',
      args: [zoneArg],
      options: {
        type: { type: 'string', valueName: '<type>', description: 'The display type: bar or banner (see display-types).' },
        set: { type: 'string', multiple: true, valueName: '<key=value>', description: 'A setting, such as gap=8 or shape=rounded-square (true, false and numbers are not text: see above).' },
        settings: { type: 'string', valueName: '<json>', description: 'Settings as a JSON object.' },
        reset: { type: 'boolean', description: 'Start from the type\'s defaults instead of the current settings.' },
      },
      examples: [
        'taleart zones display home-top --type bar',
        'taleart zones display home-top --type bar --set shape=rounded-square --set size=large --set gap=8',
        'taleart zones display promo --type banner --settings \'{"aspectRatio":"3:1","autoplay":true}\'',
      ],
      async run(ctx) {
        const type = ctx.opts['type'] as string | undefined;
        const pairs = (ctx.opts['set'] as string[] | undefined) ?? [];
        const jsonText = ctx.opts['settings'] as string | undefined;
        if (!type && pairs.length === 0 && jsonText === undefined && !ctx.opts['reset']) {
          throw usageError('Give --type, --set, --settings or --reset');
        }
        const given = parseSettings(pairs, jsonText);
        const hasSettings = pairs.length > 0 || jsonText !== undefined;
        const client = ctx.client();
        const zone = await resolveZone(client, ctx.args['zone'] as string, await ctx.projectIdOrNull());
        let frame: Frame;
        if (!zone.frame) {
          if (!type) throw usageError(`Zone ${zone.slug} has no display yet: give --type bar or --type banner`);
          const body: SetFrameRequest = { type, ...(hasSettings && { settings: given }) };
          frame = await client.post<Frame>(`/zones/${seg(zone.id)}/frame`, body);
        } else if (type && type !== zone.frame.type) {
          // A new type starts from its defaults; settings given with it change only what they name.
          let body: UpdateFrameRequest = { type };
          if (hasSettings) {
            const types = await client.get<FrameType[]>('/frame-types');
            const target = types.find((t) => t.key === type);
            // An unknown type: the API names the problem (400 unknown_frame_type).
            body = { type, settings: target ? { ...defaultsOf(target), ...given } : given };
          }
          frame = await client.patch<Frame>(`/zones/${seg(zone.id)}/frame`, body);
        } else if (ctx.opts['reset']) {
          const types = await client.get<FrameType[]>('/frame-types');
          const body: UpdateFrameRequest = { settings: { ...defaultsOf(types.find((t) => t.key === zone.frame?.type)), ...given } };
          frame = await client.patch<Frame>(`/zones/${seg(zone.id)}/frame`, body);
        } else if (hasSettings) {
          const body: UpdateFrameRequest = { settings: { ...zone.frame.settings, ...given } };
          frame = await client.patch<Frame>(`/zones/${seg(zone.id)}/frame`, body);
        } else {
          // Already this type, nothing else asked: unchanged.
          frame = zone.frame;
        }
        return { data: frame, text: `Display of ${zone.slug}: ${frame.type} ${JSON.stringify(frame.settings)}` };
      },
    },
    {
      name: 'display-types',
      mutates: false,
      result: 'FrameType[]',
      summary: 'List the display types and the settings each one takes.',
      examples: ['taleart zones display-types', 'taleart zones display-types --json'],
      async run(ctx) {
        const types = await ctx.client().get<FrameType[]>('/frame-types');
        const lines: string[] = [];
        for (const type of types) {
          lines.push(`${type.key} (${type.label})`);
          for (const [key, field] of Object.entries(settingFields(type))) lines.push(`  ${key}: ${field}`);
        }
        return { data: types, text: lines.join('\n') || 'No display types.' };
      },
    },
    {
      name: 'snippet',
      mutates: false,
      result: '{ "zone": string, "snippet": string, "testPageUrl": string, "apiUrl": string, "sdkUrl": string }',
      summary: 'Print the HTML that places a zone on a page, and its test page link.',
      description:
        'The site key is shown only when it is issued, so the snippet says YOUR_SITE_KEY unless you pass --site-key ' +
        '(or set TALEART_SITE_KEY). The test page link carries the key in its fragment, never sent to a server.',
      project: 'optional',
      args: [zoneArg],
      options: {
        'site-key': { type: 'string', valueName: '<tas_…>', description: 'The project\'s site key, to put in the snippet and link.' },
      },
      examples: ['taleart zones snippet home-top', 'taleart zones snippet home-top --site-key "$SITE_KEY" --json'],
      async run(ctx) {
        const client = ctx.client();
        const siteKey = (ctx.opts['site-key'] as string | undefined) || ctx.io.env['TALEART_SITE_KEY'] || null;
        const [zone, info] = await Promise.all([
          resolveZone(client, ctx.args['zone'] as string, await ctx.projectIdOrNull()),
          client.get<InstallInfo>('/install'),
        ]);
        const snippet = installSnippet(info, zone.slug, siteKey);
        const testPageUrl = testPageLink(info, zone.slug, siteKey);
        if (!zone.frame) ctx.warn(`Zone ${zone.slug} has no display yet: it shows nothing until you run taleart zones display.`);
        return {
          data: { zone: zone.slug, snippet, testPageUrl, apiUrl: info.apiUrl, sdkUrl: info.sdkUrl },
          text: `${snippet}\n\nTest page: ${testPageUrl}`,
        };
      },
    },
  ],
};

interface SchemaField {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

function settingFields(type: FrameType): Record<string, string> {
  const properties = ((type.schema as { properties?: Record<string, SchemaField> }).properties ?? {}) as Record<string, SchemaField>;
  const out: Record<string, string> = {};
  for (const [key, field] of Object.entries(properties)) {
    const kind =
      field.enum ? field.enum.join('|')
      : field.minimum !== undefined || field.maximum !== undefined ? `${field.type} ${field.minimum ?? ''}..${field.maximum ?? ''}`
      : (field.type ?? 'any');
    out[key] = `${kind}${field.default !== undefined ? ` (default ${JSON.stringify(field.default)})` : ''}`;
  }
  return out;
}

function defaultsOf(type: FrameType | undefined): Record<string, unknown> {
  if (!type) throw new CliError('The zone\'s display type is not in the registry', EXIT.unexpected, 'unknown_frame_type');
  const properties = ((type.schema as { properties?: Record<string, SchemaField> }).properties ?? {}) as Record<string, SchemaField>;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(properties)) if (field.default !== undefined) out[key] = field.default;
  return out;
}
