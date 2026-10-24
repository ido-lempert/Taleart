import type { IssuedSiteKey, IssueSiteKeyRequest, SiteKeyInfo } from '@taleart/contract/core';
import type { GroupSpec } from '../command';
import { CliError } from '../errors';
import { record } from '../output';
import { seg } from '../resolve';

function issuedText(issued: IssuedSiteKey): string {
  return `${issued.key}\n\nThis is the only time the site key is shown: put it in your page's <taleart-view site-key="…"> now.`;
}

export const siteKeys: GroupSpec = {
  name: 'site-keys',
  aliases: ['site-key'],
  summary: 'Issue, rotate and revoke the project\'s site key (admins).',
  description:
    'A project has at most one active site key (tas_…): host pages send it to the Delivery API to show every zone of the ' +
    'project. It is shown only when issued; the API stores only its hash. Rotating or revoking it affects every zone of the project.',
  commands: [
    {
      name: 'get',
      summary: 'Show whether the project has an active site key (its prefix and date, never the key).',
      project: 'required',
      examples: ['taleart site-keys get', 'taleart site-keys get --json'],
      async run(ctx) {
        const info = await ctx.client().get<SiteKeyInfo | null>(`/projects/${seg(await ctx.projectId())}/site-key`);
        return {
          data: info,
          text: info ? record([['prefix', info.prefix], ['issued', info.createdAt]]) : 'No active site key: run taleart site-keys issue.',
        };
      },
    },
    {
      name: 'issue',
      summary: 'Issue the project\'s site key when it has none (prints the key once).',
      project: 'required',
      examples: ['taleart site-keys issue', 'SITE_KEY=$(taleart site-keys issue --json | jq -r .key)'],
      async run(ctx) {
        const body: IssueSiteKeyRequest = { ifNone: true };
        try {
          const issued = await ctx.client().post<IssuedSiteKey>(`/projects/${seg(await ctx.projectId())}/site-key`, body);
          return { data: issued, text: issuedText(issued) };
        } catch (err) {
          if (err instanceof CliError && err.code === 'site_key_exists') {
            throw new CliError(err.message, err.exitCode, err.code, err.status, 'The project already has a site key; taleart site-keys rotate replaces it.');
          }
          throw err;
        }
      },
    },
    {
      name: 'rotate',
      summary: 'Replace the project\'s site key with a new one (prints it once).',
      description: 'The current key stops working at once, on every page and for every zone of the project.',
      project: 'required',
      destructive: true,
      examples: ['taleart site-keys rotate --yes'],
      async run(ctx) {
        const projectId = await ctx.projectId();
        await ctx.confirm(`Rotate the site key of project ${projectId}? The current key stops working on every page at once.`);
        const issued = await ctx.client().post<IssuedSiteKey>(`/projects/${seg(projectId)}/site-key`, {} satisfies IssueSiteKeyRequest);
        return { data: issued, text: issuedText(issued) };
      },
    },
    {
      name: 'revoke',
      summary: 'Revoke the project\'s site key: every zone stops showing at once.',
      project: 'required',
      destructive: true,
      jsonShape: '{ "revoked": true }',
      examples: ['taleart site-keys revoke --yes'],
      async run(ctx) {
        const projectId = await ctx.projectId();
        await ctx.confirm(`Revoke the site key of project ${projectId}? Every zone of the project stops showing at once.`);
        await ctx.client().delete(`/projects/${seg(projectId)}/site-key`);
        return { data: { revoked: true }, text: 'Site key revoked.' };
      },
    },
  ],
};
