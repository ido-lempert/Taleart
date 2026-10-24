import {
  MAX_USER_LIST_CSV_BYTES,
  type CreateUserListRequest,
  type RenameUserListRequest,
  type UserList,
  type UserListUploadReport,
} from '@taleart/contract/core';
import type { GroupSpec } from '../command';
import { UPLOAD_TIMEOUT_MS } from '../client';
import { CliError, EXIT } from '../errors';
import { fileBlob, localFile } from '../media';
import { record, table } from '../output';
import { resolveUserList, seg } from '../resolve';

const listArg = { name: 'list', description: 'The user list\'s id or name.', required: true };

function listText(list: UserList): string {
  return record([
    ['id', list.id],
    ['name', list.name],
    ['ids', list.idCount],
    ['updated', list.updatedAt],
  ]);
}

export const userLists: GroupSpec = {
  name: 'user-lists',
  summary: 'Create user lists, add external user IDs from a CSV, delete lists.',
  description:
    'A user list holds external user IDs (your own users\' ids) for targeting. The API stores each ID only as a keyed hash ' +
    'and never returns one: a list tells how many it holds, never which.',
  commands: [
    {
      name: 'list',
      mutates: false,
      result: 'UserList[]',
      summary: 'List the project\'s user lists with how many IDs each holds.',
      project: 'required',
      examples: ['taleart user-lists list', 'taleart user-lists list --json'],
      async run(ctx) {
        const lists = await ctx.client().get<UserList[]>(`/projects/${seg(await ctx.projectId())}/user-lists`);
        return {
          data: lists,
          text: table(
            lists,
            [
              { label: 'id', value: (l) => l.id },
              { label: 'name', value: (l) => l.name },
              { label: 'ids', value: (l) => l.idCount },
              { label: 'updated', value: (l) => l.updatedAt },
            ],
            'No user lists.',
          ),
        };
      },
    },
    {
      name: 'get',
      mutates: false,
      result: 'UserList',
      summary: 'Show one user list.',
      project: 'required',
      args: [listArg],
      examples: ['taleart user-lists get VIPs'],
      async run(ctx) {
        const list = await resolveUserList(ctx.client(), ctx.args['list'] as string, await ctx.projectId());
        return { data: list, text: listText(list) };
      },
    },
    {
      name: 'create',
      mutates: true,
      result: 'UserList',
      summary: 'Create an empty user list.',
      project: 'required',
      options: { name: { type: 'string', required: true, valueName: '<name>', description: 'The list\'s name, unique in the project.' } },
      examples: ['taleart user-lists create --name VIPs'],
      async run(ctx) {
        const body: CreateUserListRequest = { name: ctx.opts['name'] as string };
        const list = await ctx.client().post<UserList>(`/projects/${seg(await ctx.projectId())}/user-lists`, body);
        return { data: list, text: listText(list) };
      },
    },
    {
      name: 'update',
      mutates: true,
      result: 'UserList',
      summary: 'Rename a user list.',
      project: 'required',
      args: [listArg],
      options: { name: { type: 'string', required: true, valueName: '<name>', description: 'The new name.' } },
      examples: ['taleart user-lists update VIPs --name "Top customers"'],
      async run(ctx) {
        const projectId = await ctx.projectId();
        const client = ctx.client();
        const list = await resolveUserList(client, ctx.args['list'] as string, projectId);
        const body: RenameUserListRequest = { name: ctx.opts['name'] as string };
        const renamed = await client.patch<UserList>(`/projects/${seg(projectId)}/user-lists/${seg(list.id)}`, body);
        return { data: renamed, text: listText(renamed) };
      },
    },
    {
      name: 'upload',
      mutates: true,
      result: 'UserListUploadReport',
      summary: 'Add the IDs of a single-column CSV (one ID per row) to a user list.',
      description:
        'All or nothing: refused rows are counted and the first ones named by line number, never by value. --header skips the ' +
        'first row. At most 50 MB and 1,000,000 rows. Prints the upload report (counts only).',
      project: 'required',
      args: [listArg, { name: 'file', description: 'The CSV file (UTF-8).', required: true }],
      options: { header: { type: 'boolean', description: 'The first row is a header: skip it.' } },
      examples: ['taleart user-lists upload VIPs ./vips.csv', 'taleart user-lists upload VIPs ./export.csv --header --json'],
      async run(ctx) {
        const file = localFile(ctx.io.cwd, ctx.args['file'] as string);
        if (file.size > MAX_USER_LIST_CSV_BYTES) {
          throw new CliError(`${file.name} is ${file.size} bytes; a user list upload holds at most ${MAX_USER_LIST_CSV_BYTES}`, EXIT.invalid, 'user_list_file_too_large');
        }
        const projectId = await ctx.projectId();
        const client = ctx.client();
        const list = await resolveUserList(client, ctx.args['list'] as string, projectId);
        const report = await client.request<UserListUploadReport>('POST', `/projects/${seg(projectId)}/user-lists/${seg(list.id)}/ids`, {
          body: await fileBlob(file.path, 'text/csv'),
          contentType: 'text/csv',
          query: { header: ctx.opts['header'] ? 'true' : undefined },
          timeoutMs: UPLOAD_TIMEOUT_MS,
        });
        return {
          data: report,
          text: record([
            ['added', report.added],
            ['already present', report.alreadyPresent],
            ['refused', report.refused],
            ['empty rows', report.emptyRows],
            ['look like emails', report.emailLike],
            ['look like phones', report.phoneLike],
            ['ids in the list', report.idCount],
            ...report.refusedRows.map((r) => [`line ${r.line}`, r.reason] as [string, unknown]),
          ]),
        };
      },
    },
    {
      name: 'delete',
      mutates: true,
      result: '{ "deleted": true, "id": string }',
      summary: 'Delete a user list and every ID it holds, for good.',
      project: 'required',
      args: [listArg],
      destructive: true,
      examples: ['taleart user-lists delete VIPs --yes'],
      async run(ctx) {
        const projectId = await ctx.projectId();
        const client = ctx.client();
        const list = await resolveUserList(client, ctx.args['list'] as string, projectId, ctx.exact);
        await ctx.confirm(`Delete user list "${list.name}" and its ${list.idCount} IDs for good?`);
        await client.delete(`/projects/${seg(projectId)}/user-lists/${seg(list.id)}`);
        return { data: { deleted: true, id: list.id }, text: `Deleted user list ${list.name}.` };
      },
    },
  ],
};
