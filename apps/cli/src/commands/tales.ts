import {
  switchStatus,
  isSwitchable,
  type CreateTaleRequest,
  type SetStatusRequest,
  type Tale,
  type TaleGroup,
} from '@taleart/contract/core';
import type { TaleStatusResult } from '@taleart/contract/tale-document';
import type { Context, GroupSpec } from '../command';
import { UPLOAD_TIMEOUT_MS } from '../client';
import { CliError, EXIT, usageError } from '../errors';
import { fileBlob, mediaFile, titleFromFile } from '../media';
import { asCliError } from '../output';
import { resolveGroupId, seg } from '../resolve';
import { taleStatus, talesTable, taleText } from './format';

const taleArg = { name: 'tale', description: 'The tale\'s id.', required: true };
const groupOption = {
  group: { type: 'string' as const, required: true, valueName: '<group>', description: 'The tale group (id, or name within --project).' },
};

async function uploadMedia(ctx: Context, taleId: string, file: ReturnType<typeof mediaFile>): Promise<Tale> {
  return ctx.client().request<Tale>('PUT', `/tales/${seg(taleId)}/media`, {
    body: await fileBlob(file.path, file.contentType),
    contentType: file.contentType,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
}

async function setShown(ctx: Context, shown: boolean) {
  const client = ctx.client();
  const id = ctx.args['tale'] as string;
  const tale = await client.get<Tale>(`/tales/${seg(id)}`);
  if (!isSwitchable(tale.storedStatus)) {
    throw new CliError(`Tale ${tale.title} is ${tale.storedStatus}; it cannot be ${shown ? 'shown' : 'hidden'}`, EXIT.conflict, 'invalid_status_transition');
  }
  const next = switchStatus(tale.storedStatus, shown);
  if (!next) return { data: tale, text: `${tale.title}: ${taleStatus(tale)}` };
  const result = await client.put<TaleStatusResult>(`/tales/${seg(id)}/status`, { status: next } satisfies SetStatusRequest);
  if (result.draftNotPublished) ctx.warn(`The tale's draft was not published: ${result.draftNotPublishedReason ?? 'it no longer passes the check'}.`);
  return { data: result, text: `${result.title}: ${taleStatus(result)}` };
}

export const tales: GroupSpec = {
  name: 'tales',
  summary: 'Create tales from image or video files, show or hide them, replace their media, delete them.',
  description:
    'A tale is one full-screen page of a tale group: an image (PNG, JPEG, GIF, WebP, up to 10 MB) or a video (MP4, WebM, ' +
    'up to 100 MB). A new tale is Shown; it reaches the site when its group is On.',
  commands: [
    {
      name: 'list',
      mutates: false,
      result: 'Tale[]',
      summary: 'List a tale group\'s tales in order.',
      project: 'optional',
      options: groupOption,
      examples: ['taleart tales list --group Summer', 'taleart tales list --group 7b2e… --json'],
      async run(ctx) {
        const id = await resolveGroupId(ctx.client(), ctx.opts['group'] as string, () => ctx.projectId());
        const group = await ctx.client().get<TaleGroup>(`/tale-groups/${seg(id)}`);
        return { data: group.tales, text: talesTable(group.tales) };
      },
    },
    {
      name: 'get',
      mutates: false,
      result: 'Tale',
      summary: 'Show one tale with its status, media and visibility.',
      args: [taleArg],
      examples: ['taleart tales get 9c0d…'],
      async run(ctx) {
        const tale = await ctx.client().get<Tale>(`/tales/${seg(ctx.args['tale'] as string)}`);
        return { data: tale, text: taleText(tale) };
      },
    },
    {
      name: 'create',
      mutates: true,
      result: 'Tale[]',
      summary: 'Add one tale per file to a tale group, in the order given, uploading each file as its media.',
      description:
        'Every file is checked first (type from its first bytes, size), so a bad file stops the command before anything is ' +
        'created. Each tale is titled after its file name unless --title is given (one file only). When an upload fails the ' +
        'tale it made is deleted again and the command stops, keeping the tales already made. Prints the tales.',
      project: 'optional',
      args: [{ name: 'files', description: 'Image or video files.', required: true, variadic: true }],
      options: {
        ...groupOption,
        title: { type: 'string', valueName: '<title>', description: 'The tale\'s title (one file only).' },
      },
      examples: ['taleart tales create --group Summer ./img/one.png ./img/two.png', 'taleart tales create --group Summer clip.mp4 --title "Launch"'],
      async run(ctx) {
        const paths = ctx.args['files'] as string[];
        const title = ctx.opts['title'] as string | undefined;
        if (title !== undefined && paths.length > 1) throw usageError('--title names one tale: give one file, or leave it out');
        const files = paths.map((p) => mediaFile(ctx.io.cwd, p));
        const client = ctx.client();
        const groupId = await resolveGroupId(client, ctx.opts['group'] as string, () => ctx.projectId());
        const created: Tale[] = [];
        for (const file of files) {
          const body: CreateTaleRequest = { title: title ?? titleFromFile(file.name) };
          const tale = await client.post<Tale>(`/tale-groups/${seg(groupId)}/tales`, body);
          try {
            created.push(await uploadMedia(ctx, tale.id, file));
          } catch (err) {
            const cleaned = await client.delete(`/tales/${seg(tale.id)}`).then(
              () => true,
              () => false,
            );
            if (!cleaned) ctx.warn(`Could not delete the tale left without media, ${tale.id}: delete it with taleart tales delete.`);
            if (created.length > 0) ctx.warn(`Created ${created.length} tale(s) before the failure: ${created.map((t) => t.id).join(', ')}`);
            const failure = asCliError(err);
            // The error document says what is left, so a script can go on from there.
            throw new CliError(`${file.name}: ${failure.message}`, failure.exitCode, failure.code, failure.status, failure.hint, {
              ...failure.details,
              file: file.name,
              created,
              ...(!cleaned && { leftWithoutMedia: tale.id }),
            });
          }
          ctx.info(`Created tale ${tale.id} from ${file.name}`);
        }
        return { data: created, text: talesTable(created) };
      },
    },
    {
      name: 'media',
      mutates: true,
      result: 'Tale',
      summary: 'Replace a tale\'s image or video with a local file.',
      args: [taleArg, { name: 'file', description: 'An image or video file.', required: true }],
      examples: ['taleart tales media 9c0d… ./img/new.png'],
      async run(ctx) {
        const file = mediaFile(ctx.io.cwd, ctx.args['file'] as string);
        const tale = await uploadMedia(ctx, ctx.args['tale'] as string, file);
        return { data: tale, text: taleText(tale) };
      },
    },
    {
      name: 'hide',
      mutates: true,
      result: 'TaleStatusResult',
      summary: 'Hide a tale: it stops showing, its group stays as it is.',
      args: [taleArg],
      examples: ['taleart tales hide 9c0d…'],
      run: (ctx) => setShown(ctx, false),
    },
    {
      name: 'show',
      mutates: true,
      result: 'TaleStatusResult',
      summary: 'Show a tale again (it reaches the site when its group is On).',
      args: [taleArg],
      examples: ['taleart tales show 9c0d…'],
      run: (ctx) => setShown(ctx, true),
    },
    {
      name: 'delete',
      mutates: true,
      result: '{ "deleted": true, "id": string }',
      summary: 'Delete a tale for good, with its documents and the visitors\' responses to it.',
      args: [taleArg],
      destructive: true,
      examples: ['taleart tales delete 9c0d… --yes'],
      async run(ctx) {
        const id = ctx.args['tale'] as string;
        const client = ctx.client();
        const tale = await client.get<Tale>(`/tales/${seg(id)}`);
        await ctx.confirm(`Delete tale "${tale.title}" (${tale.id}) for good?`);
        await client.delete(`/tales/${seg(id)}`);
        return { data: { deleted: true, id }, text: `Deleted tale ${tale.title}.` };
      },
    },
  ],
};
