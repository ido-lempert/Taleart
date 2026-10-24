import type { ImportJob, ImportJobSummary } from '@taleart/contract/core';
import type { GroupSpec } from '../command';
import { record, table } from '../output';
import { seg } from '../resolve';

export const imports: GroupSpec = {
  name: 'imports',
  summary: 'Read the project\'s Storyly imports and their progress (read only; admins).',
  description:
    'Imports are started in the dashboard (Settings > Import). These commands only read them: the list, and one job with its ' +
    'state, progress and report. The server answers 503 importer_not_configured (exit 8) when its importer is off.',
  commands: [
    {
      name: 'list',
      summary: 'List the project\'s imports, newest first (at most 50).',
      project: 'required',
      examples: ['taleart imports list', 'taleart imports list --json'],
      async run(ctx) {
        const jobs = await ctx.client().get<ImportJobSummary[]>(`/projects/${seg(await ctx.projectId())}/imports`);
        return {
          data: jobs,
          text: table(
            jobs,
            [
              { label: 'id', value: (j) => j.id },
              { label: 'status', value: (j) => j.status },
              { label: 'app', value: (j) => j.sourceAppName },
              { label: 'created', value: (j) => j.createdAt },
              { label: 'finished', value: (j) => j.finishedAt },
              { label: 'error', value: (j) => j.error },
            ],
            'No imports.',
          ),
        };
      },
    },
    {
      name: 'get',
      summary: 'Show one import: its state, progress and report.',
      project: 'required',
      args: [{ name: 'import', description: 'The import job\'s id.', required: true }],
      examples: ['taleart imports get 5e7f…', 'taleart imports get 5e7f… --json'],
      async run(ctx) {
        const job = await ctx.client().get<ImportJob>(`/projects/${seg(await ctx.projectId())}/imports/${seg(ctx.args['import'] as string)}`);
        return {
          data: job,
          text: record([
            ['id', job.id],
            ['status', job.status],
            ['app', job.sourceAppName],
            ['created', job.createdAt],
            ['started', job.startedAt],
            ['finished', job.finishedAt],
            ['error', job.error],
            ['progress', job.progress],
            ['report', job.report],
          ]),
        };
      },
    },
  ],
};
