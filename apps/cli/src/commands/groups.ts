import {
  isSwitchable,
  switchStatus,
  type CopyTaleGroupRequest,
  type CreateTaleGroupRequest,
  type ProjectTaleGroup,
  type RenameTaleGroupRequest,
  type SetStatusRequest,
  type SetTaleGroupTagsRequest,
  type Tag,
  type TaleGroup,
  type ZoneTaleGroup,
} from '@taleart/contract/core';
import type { Context, GroupSpec } from '../command';
import { CliError, EXIT, usageError } from '../errors';
import { table } from '../output';
import { resolveGroupId, resolveZoneId, seg } from '../resolve';
import { groupStatus, groupText, visible } from './format';

const groupArg = { name: 'group', description: 'The tale group\'s id or name (a name within --project).', required: true };
const zoneOption = (description: string, required = false) => ({
  zone: { type: 'string' as const, valueName: '<zone>', required, description },
});

async function groupId(ctx: Context): Promise<string> {
  return resolveGroupId(ctx.client(), ctx.args['group'] as string, () => ctx.projectId());
}

async function zoneId(ctx: Context): Promise<string> {
  return resolveZoneId(ctx.client(), ctx.opts['zone'] as string, await ctx.projectIdOrNull());
}

/** Turns a group On (`live`) or Off (`paused`); a group already there is left as it is. */
async function setOn(ctx: Context, on: boolean) {
  const client = ctx.client();
  const id = await groupId(ctx);
  const group = await client.get<TaleGroup>(`/tale-groups/${seg(id)}`);
  if (!isSwitchable(group.storedStatus)) {
    throw new CliError(
      `Tale group ${group.name} is ${group.storedStatus}; only a draft, On or Off group can be turned ${on ? 'On' : 'Off'}`,
      EXIT.conflict,
      'invalid_status_transition',
    );
  }
  const next = switchStatus(group.storedStatus, on);
  const result = next ? await client.put<TaleGroup>(`/tale-groups/${seg(id)}/status`, { status: next } satisfies SetStatusRequest) : group;
  if (on && result.tales.length === 0) ctx.warn(`Tale group ${result.name} has no tales yet: add some with taleart tales create.`);
  if (on && result.zoneIds.length === 0) ctx.warn(`Tale group ${result.name} is placed in no zone: place it with taleart groups place.`);
  return { data: result, text: `${result.name}: ${groupStatus(result)} (visible: ${visible(result.visibility)})` };
}

export const groups: GroupSpec = {
  name: 'groups',
  aliases: ['tale-groups'],
  summary: 'Create tale groups, turn them On or Off, set their tags, copy them and place them in zones.',
  description:
    'A tale group is a set of tales shown as one circle (bar) or slide (banner). It belongs to the project and can be placed ' +
    'in several zones. A new group is Off; turn it On to show it. Its tags decide which viewers see it (--match any or all).',
  commands: [
    {
      name: 'list',
      mutates: false,
      result: 'ProjectTaleGroup[] (ZoneTaleGroup[] with --zone)',
      summary: 'List the project\'s tale groups, or the groups placed in a zone (in their order there).',
      project: 'optional',
      options: zoneOption('List the groups placed in this zone (id or slug), with their position.'),
      examples: ['taleart groups list', 'taleart groups list --zone home-top --json'],
      async run(ctx) {
        const client = ctx.client();
        if (typeof ctx.opts['zone'] === 'string') {
          const list = await client.get<ZoneTaleGroup[]>(`/zones/${seg(await zoneId(ctx))}/tale-groups`);
          return {
            data: list,
            text: table(
              list,
              [
                { label: 'position', value: (g) => g.position },
                { label: 'id', value: (g) => g.id },
                { label: 'name', value: (g) => g.name },
                { label: 'status', value: (g) => groupStatus(g) },
                { label: 'tales', value: (g) => g.tales.length },
                { label: 'visible', value: (g) => visible(g.visibility) },
              ],
              'No tale groups in this zone.',
            ),
          };
        }
        const projectId = await ctx.projectId();
        const list = await client.get<ProjectTaleGroup[]>(`/projects/${seg(projectId)}/tale-groups`);
        return {
          data: list,
          text: table(
            list,
            [
              { label: 'id', value: (g) => g.id },
              { label: 'name', value: (g) => g.name },
              { label: 'status', value: (g) => groupStatus(g) },
              { label: 'tales', value: (g) => g.taleCount },
              { label: 'zones', value: (g) => g.zoneIds.length },
              { label: 'tags', value: (g) => g.tags.map((t) => t.name).join(', ') },
              { label: 'visible', value: (g) => visible(g.visibility) },
            ],
            'No tale groups.',
          ),
        };
      },
    },
    {
      name: 'get',
      mutates: false,
      result: 'TaleGroup',
      summary: 'Show a tale group with its tales, tags, zones and visibility.',
      project: 'optional',
      args: [groupArg],
      examples: ['taleart groups get Summer', 'taleart groups get 7b2e… --json'],
      async run(ctx) {
        const group = await ctx.client().get<TaleGroup>(`/tale-groups/${seg(await groupId(ctx))}`);
        return { data: group, text: groupText(group) };
      },
    },
    {
      name: 'create',
      mutates: true,
      result: 'ProjectTaleGroup (ZoneTaleGroup with --zone)',
      summary: 'Create a tale group (Off), in the project or placed in a zone.',
      project: 'optional',
      options: {
        name: { type: 'string', required: true, valueName: '<name>', description: 'The group\'s name (shown under its cover).' },
        ...zoneOption('Place the new group in this zone (id or slug), after its groups.'),
      },
      examples: ['taleart groups create --name Summer --zone home-top', 'taleart groups create --name Drafts --json'],
      async run(ctx) {
        const client = ctx.client();
        const body: CreateTaleGroupRequest = { name: ctx.opts['name'] as string };
        const group =
          typeof ctx.opts['zone'] === 'string' ?
            await client.post<ZoneTaleGroup>(`/zones/${seg(await zoneId(ctx))}/tale-groups`, body)
          : await client.post<ProjectTaleGroup>(`/projects/${seg(await ctx.projectId())}/tale-groups`, body);
        return { data: group, text: `Created tale group ${group.name} (${group.id}), Off.` };
      },
    },
    {
      name: 'update',
      mutates: true,
      result: 'TaleGroup',
      summary: 'Rename a tale group (every zone shows the new name).',
      project: 'optional',
      args: [groupArg],
      options: { name: { type: 'string', required: true, valueName: '<name>', description: 'The new name.' } },
      examples: ['taleart groups update Summer --name "Summer sale"'],
      async run(ctx) {
        const body: RenameTaleGroupRequest = { name: ctx.opts['name'] as string };
        const group = await ctx.client().patch<TaleGroup>(`/tale-groups/${seg(await groupId(ctx))}`, body);
        return { data: group, text: groupText(group) };
      },
    },
    {
      name: 'on',
      mutates: true,
      result: 'TaleGroup',
      summary: 'Turn a tale group On: its shown tales reach the site in every zone it is placed in.',
      project: 'optional',
      args: [groupArg],
      examples: ['taleart groups on Summer', 'taleart groups on 7b2e… --json'],
      run: (ctx) => setOn(ctx, true),
    },
    {
      name: 'off',
      mutates: true,
      result: 'TaleGroup',
      summary: 'Turn a tale group Off: it stops showing everywhere at once.',
      project: 'optional',
      args: [groupArg],
      examples: ['taleart groups off Summer'],
      run: (ctx) => setOn(ctx, false),
    },
    {
      name: 'tags',
      mutates: true,
      result: 'TaleGroup',
      summary: 'Set a tale group\'s targeting tags and how they match.',
      description:
        'The tags given become the group\'s whole set (missing tags are created in the project). --match any shows the group ' +
        'to a viewer with at least one of them, all only to a viewer with every one. With only --match the tags stay; --clear removes them all.',
      project: 'optional',
      args: [groupArg],
      options: {
        tag: { type: 'string', multiple: true, valueName: '<name>', description: 'A tag name.' },
        match: { type: 'string', valueName: '<any|all>', choices: ['any', 'all'], description: 'How the tags combine.' },
        clear: { type: 'boolean', description: 'Remove every tag.' },
      },
      examples: ['taleart groups tags Summer --tag vip --tag beta --match all', 'taleart groups tags Summer --clear'],
      async run(ctx) {
        const names = ((ctx.opts['tag'] as string[] | undefined) ?? []).map((n) => n.trim()).filter(Boolean);
        const match = ctx.opts['match'] as SetTaleGroupTagsRequest['tagMatch'] | undefined;
        const clear = ctx.opts['clear'] === true;
        if (clear && names.length > 0) throw usageError('Give --tag or --clear, not both');
        if (!clear && names.length === 0 && !match) throw usageError('Give --tag, --match or --clear');
        const client = ctx.client();
        const id = await groupId(ctx);
        const group = await client.get<TaleGroup>(`/tale-groups/${seg(id)}`);
        let tagIds: string[];
        if (clear) tagIds = [];
        else if (names.length === 0) tagIds = group.tags.map((t) => t.id);
        else {
          const existing = await client.get<Tag[]>(`/projects/${seg(group.projectId)}/tags`);
          tagIds = [];
          for (const name of names) {
            let tag = existing.find((t) => t.name.toLowerCase() === name.toLowerCase());
            if (!tag) {
              tag = await client.post<Tag>(`/projects/${seg(group.projectId)}/tags`, { name });
              existing.push(tag);
              ctx.info(`Created tag ${tag.name}`);
            }
            tagIds.push(tag.id);
          }
        }
        const body: SetTaleGroupTagsRequest = { tagIds, ...(match && { tagMatch: match }) };
        const updated = await client.put<TaleGroup>(`/tale-groups/${seg(id)}/tags`, body);
        return {
          data: updated,
          text: `${updated.name}: tags ${updated.tags.map((t) => t.name).join(', ') || '(none)'}, match ${updated.tagMatch}`,
        };
      },
    },
    {
      name: 'copy',
      mutates: true,
      result: 'ZoneTaleGroup',
      summary: 'Copy a tale group, with its tales and tags, into a zone as an independent group.',
      project: 'optional',
      args: [groupArg],
      options: zoneOption('The zone (id or slug) the copy is placed in; another project\'s zone by id.', true),
      examples: ['taleart groups copy Summer --zone footer', 'taleart groups copy 7b2e… --zone 41aa… --json'],
      async run(ctx) {
        const body: CopyTaleGroupRequest = { zoneId: await zoneId(ctx) };
        const copy = await ctx.client().post<ZoneTaleGroup>(`/tale-groups/${seg(await groupId(ctx))}/copy`, body);
        return { data: copy, text: `Copied to ${copy.name} (${copy.id}), ${groupStatus(copy)}, position ${copy.position}.` };
      },
    },
    {
      name: 'place',
      mutates: true,
      result: 'ZoneTaleGroup',
      summary: 'Place a tale group in a zone, after the zone\'s groups (the same group, not a copy).',
      project: 'optional',
      args: [groupArg],
      options: zoneOption('The zone (id or slug).', true),
      examples: ['taleart groups place Summer --zone home-top'],
      async run(ctx) {
        const placed = await ctx.client().put<ZoneTaleGroup>(`/zones/${seg(await zoneId(ctx))}/tale-groups/${seg(await groupId(ctx))}`);
        return { data: placed, text: `${placed.name} is placed at position ${placed.position}.` };
      },
    },
    {
      name: 'unplace',
      mutates: true,
      result: '{ "removed": true, "zoneId": string, "taleGroupId": string }',
      summary: 'Remove a tale group from a zone (the group and its other placements stay).',
      project: 'optional',
      args: [groupArg],
      options: zoneOption('The zone (id or slug).', true),
      examples: ['taleart groups unplace Summer --zone home-top'],
      async run(ctx) {
        const zone = await zoneId(ctx);
        const group = await groupId(ctx);
        await ctx.client().delete(`/zones/${seg(zone)}/tale-groups/${seg(group)}`);
        return { data: { removed: true, zoneId: zone, taleGroupId: group }, text: 'Removed from the zone.' };
      },
    },
  ],
};
