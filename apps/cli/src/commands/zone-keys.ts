import type { IssuedZoneKey, ZoneKeyInfo } from '@taleart/contract/core';
import type { Context, GroupSpec } from '../command';
import { CliError, EXIT } from '../errors';
import { record } from '../output';
import { resolveZone, seg } from '../resolve';

const zoneArg = { name: 'zone', description: 'The zone\'s id or slug.', required: true };

function issuedText(issued: IssuedZoneKey): string {
  return `${issued.key}\n\nThis is the only time the zone key is shown: put it in your page's <taleart-view zone-key="…"> now.`;
}

/** Resolves the zone named on the command line and returns its id, slug and name for messages. */
async function zoneOf(ctx: Context): Promise<{ id: string; slug: string; name: string }> {
  const zone = await resolveZone(ctx.client(), ctx.args['zone'] as string, await ctx.projectIdOrNull(), ctx.exact);
  return { id: zone.id, slug: zone.slug, name: zone.name };
}

export const zoneKeys: GroupSpec = {
  name: 'zone-keys',
  aliases: ['zone-key'],
  summary: 'Issue, rotate and revoke a zone\'s key (admins).',
  description:
    'A zone has at most one active key (tak_…): the page that shows the zone sends it as zone-key="…" and it names that one zone. ' +
    'It is shown only when issued; the API stores only its hash. Rotating or revoking it affects only this zone.',
  commands: [
    {
      name: 'info',
      mutates: false,
      result: 'ZoneKeyInfo | null',
      summary: 'Show whether the zone has an active key (its prefix and date, never the key).',
      args: [zoneArg],
      examples: ['taleart zone-keys info home-top', 'taleart zone-keys info home-top --json'],
      async run(ctx) {
        const zone = await zoneOf(ctx);
        const info = await ctx.client().get<ZoneKeyInfo | null>(`/zones/${seg(zone.id)}/key`);
        return {
          data: info,
          text: info ? record([['prefix', info.prefix], ['issued', info.createdAt]]) : `No active key for ${zone.slug}: run taleart zone-keys issue ${zone.slug}.`,
        };
      },
    },
    {
      name: 'issue',
      mutates: true,
      result: 'IssuedZoneKey',
      summary: 'Issue the zone\'s key when it has none (prints the key once).',
      args: [zoneArg],
      examples: ['taleart zone-keys issue home-top', 'KEY=$(taleart zone-keys issue home-top --json | jq -r .key)'],
      async run(ctx) {
        const zone = await zoneOf(ctx);
        const active = await ctx.client().get<ZoneKeyInfo | null>(`/zones/${seg(zone.id)}/key`);
        if (active) {
          throw new CliError(
            `Zone ${zone.slug} already has a key.`,
            EXIT.conflict,
            'zone_key_exists',
            409,
            `taleart zone-keys rotate ${zone.slug} replaces it.`,
          );
        }
        const issued = await ctx.client().post<IssuedZoneKey>(`/zones/${seg(zone.id)}/key`, {});
        return { data: issued, text: issuedText(issued) };
      },
    },
    {
      name: 'rotate',
      mutates: true,
      result: 'IssuedZoneKey',
      summary: 'Replace the zone\'s key with a new one (prints it once).',
      description: 'The current key stops working at once, on every page that shows this zone.',
      args: [zoneArg],
      destructive: true,
      examples: ['taleart zone-keys rotate home-top --yes'],
      async run(ctx) {
        const zone = await zoneOf(ctx);
        await ctx.confirm(`Rotate the key of zone "${zone.name}" (${zone.slug})? The current key stops working at once.`);
        const issued = await ctx.client().post<IssuedZoneKey>(`/zones/${seg(zone.id)}/key`, {});
        return { data: issued, text: issuedText(issued) };
      },
    },
    {
      name: 'revoke',
      mutates: true,
      result: '{ "revoked": true }',
      summary: 'Revoke the zone\'s key: the zone stops showing on pages at once.',
      args: [zoneArg],
      destructive: true,
      examples: ['taleart zone-keys revoke home-top --yes'],
      async run(ctx) {
        const zone = await zoneOf(ctx);
        await ctx.confirm(`Revoke the key of zone "${zone.name}" (${zone.slug})? The zone stops showing at once.`);
        await ctx.client().delete(`/zones/${seg(zone.id)}/key`);
        return { data: { revoked: true }, text: 'Zone key revoked.' };
      },
    },
  ],
};
