import { DEMO_PROJECT_NAME, seedDemo, SeedRefusedError, type SeedResult } from '@taleart/seed-demo';
import type { CommandSpec } from '../command';
import { CliError, EXIT } from '../errors';

export const seedDemoCommand: CommandSpec = {
  name: 'seed-demo',
  mutates: true,
  result: '{ "status": "created" | "exists" | "dry-run", "project": { "id", "name" }, "counts": { "zones", "taleGroups", "tales", "tags", "userLists" }, "zoneKeys": [{ "slug", "key" }] }',
  summary: `Make a ready demo project (${DEMO_PROJECT_NAME}) with zones, tale groups, tales and pictures.`,
  description:
    'A furniture store\'s spring campaign, so screens and screenshots are not empty: three zones (a ring bar, a banner and a ' +
    'poster bar), five tale groups with covers and tags, thirteen tales with pictures, text, buttons, a countdown, a promo ' +
    'code, a poll, a quiz, a rating and a reaction (one scheduled, one hidden), and a user list. It uses only the Management ' +
    'API, so every value passes the API\'s own checks. The token\'s user must be an admin (creating a project needs one). ' +
    `Run twice, it does nothing the second time: a project named ${DEMO_PROJECT_NAME} is the marker. It refuses an install ` +
    'whose user already has other projects, so it never fills a real install by accident; --force adds it anyway (as ' +
    `"${DEMO_PROJECT_NAME} 2" when the first one is there). The team (members and invitations) is not made here: no API ` +
    'token can create a user or an invitation. The API makes it when TALEART_SEED_DEMO=true seeds the first admin\'s install. ' +
    'Each zone gets a zone key, which the command prints once (a `created` run only); rotate one in the dashboard to see it again.',
  options: {
    force: { type: 'boolean', description: 'Seed even when the install already has projects or the demo project.' },
    'dry-run': { type: 'boolean', description: 'Check the install and say what would be made, changing nothing.' },
  },
  examples: [
    'taleart seed-demo',
    'taleart seed-demo --dry-run --json',
    'TALEART_API_URL=http://localhost:8080 TALEART_TOKEN=tat_… taleart seed-demo --json',
    'taleart seed-demo --force',
  ],
  async run(ctx) {
    const force = ctx.opts['force'] === true;
    const dryRun = ctx.opts['dry-run'] === true;
    let result: SeedResult;
    try {
      result = await seedDemo(ctx.client(), { force, dryRun, log: (message) => ctx.info(message) });
    } catch (err) {
      if (err instanceof SeedRefusedError) throw new CliError(err.message, EXIT.conflict, err.code, undefined, 'Rerun with --force, or use a fresh install.');
      throw err;
    }
    if (result.status === 'exists') {
      return {
        data: { status: result.status, project: result.project },
        text: `The demo project "${result.project.name}" is already there (${result.project.id}); nothing was changed. --force makes a second copy.`,
      };
    }
    if (result.status === 'dry-run') {
      const { zones, taleGroups, tales, tags, userLists } = result.counts;
      return {
        data: { status: result.status, project: { name: result.name }, counts: result.counts },
        text: `Would create the project "${result.name}" with ${zones} zones, ${taleGroups} tale groups, ${tales} tales, ${tags} tags and ${userLists} user list. Nothing was changed.`,
      };
    }
    const { zones, taleGroups, tales } = result.counts;
    const keys = result.zoneKeys.map((k) => `  ${k.slug}  ${k.key}`).join('\n');
    return {
      data: { status: result.status, project: result.project, counts: result.counts, zoneKeys: result.zoneKeys },
      text: `Created the demo project "${result.project.name}" (${result.project.id}): ${zones} zones, ${taleGroups} tale groups, ${tales} tales. Open the dashboard to see it.\nZone keys, for <taleart-view zone-key="…">:\n${keys}`,
    };
  },
};
