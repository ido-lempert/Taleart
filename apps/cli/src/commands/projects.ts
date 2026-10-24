import type { CreateProjectRequest, Project } from '@taleart/contract/core';
import type { GroupSpec } from '../command';
import { record, table } from '../output';
import { pickOne } from '../resolve';

export const projects: GroupSpec = {
  name: 'projects',
  summary: 'List, read, create and choose projects.',
  description:
    'A project holds zones, tale groups, tales, user lists and one site key. Most commands work in one project: ' +
    'choose it with --project, TALEART_PROJECT or `taleart projects use`.',
  commands: [
    {
      name: 'list',
      mutates: false,
      result: 'Project[]',
      summary: 'List the projects the token reaches.',
      examples: ['taleart projects list', 'taleart projects list --json'],
      async run(ctx) {
        const list = await ctx.client().get<Project[]>('/projects');
        const chosen = ctx.config.project;
        return {
          data: list,
          text: table(
            list,
            [
              { label: 'id', value: (p) => p.id },
              { label: 'name', value: (p) => p.name },
              { label: 'default', value: (p) => (chosen === p.id || chosen === p.name ? '*' : '') },
            ],
            'No projects.',
          ),
        };
      },
    },
    {
      name: 'get',
      mutates: false,
      result: 'Project',
      summary: 'Show one project.',
      args: [{ name: 'project', description: 'The project\'s id or name.', required: true }],
      examples: ['taleart projects get Shop', 'taleart projects get 3f1c…'],
      async run(ctx) {
        const list = await ctx.client().get<Project[]>('/projects');
        const project = pickOne(list, ctx.args['project'] as string, 'project', (p) => [p.name]);
        return { data: project, text: record([['id', project.id], ['name', project.name]]) };
      },
    },
    {
      name: 'create',
      mutates: true,
      result: 'Project',
      summary: 'Create a project (admins, with a read-write token for all projects).',
      options: { name: { type: 'string', required: true, valueName: '<name>', description: 'The project\'s name.' } },
      examples: ['taleart projects create --name Shop'],
      async run(ctx) {
        const body: CreateProjectRequest = { name: ctx.opts['name'] as string };
        const project = await ctx.client().post<Project>('/projects', body);
        return { data: project, text: record([['id', project.id], ['name', project.name]]) };
      },
    },
    {
      name: 'use',
      mutates: true,
      result: '{ "project": Project, "configFile": string }',
      summary: 'Make a project the default for --project (stored in the config file).',
      args: [{ name: 'project', description: 'The project\'s id or name.', required: true }],
      examples: ['taleart projects use Shop'],
      async run(ctx) {
        const list = await ctx.client().get<Project[]>('/projects');
        const project = pickOne(list, ctx.args['project'] as string, 'project', (p) => [p.name]);
        ctx.saveConfig({ ...ctx.stored, project: project.id });
        if (ctx.config.projectSource === 'env') ctx.warn('TALEART_PROJECT is set and wins over the stored default.');
        return {
          data: { project, configFile: ctx.config.file },
          text: `Default project: ${project.name} (${project.id})`,
        };
      },
    },
  ],
};
