import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LIVE_ZONES, countdownBannerZone, countdownZone } from './live-zones';
// The SDK's own checker (no imports of its own), so every live example is held to the real validateZone.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { validateZone } from '../../../../libs/web-sdk/src/lib/validate-zone';

function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('nx.json not found above ' + process.cwd());
    dir = up;
  }
  return dir;
}

describe('the live zones', () => {
  const zones: Record<string, unknown> = {
    ...LIVE_ZONES,
    COUNTDOWN_ZONE: countdownZone(),
    COUNTDOWN_BANNER_ZONE: countdownBannerZone(),
  };

  it.each(Object.keys(zones))('%s is valid zone JSON for the SDK', (name) => {
    const result = validateZone(JSON.stringify(zones[name]));
    expect(result).toEqual({ ok: true });
  });

  it('every zone is a stories bar or a promotion banner, and every bar has a readable name per group', () => {
    for (const [name, zone] of Object.entries(zones)) {
      const z = zone as { frame: { type: string }; taleGroups: { name: string }[] };
      expect(['bar', 'banner']).toContain(z.frame.type);
      for (const group of z.taleGroups) expect(group.name.trim().length, name).toBeGreaterThan(0);
    }
  });

  it('every zone is copied from a page with no request: no zone key, no API origin', () => {
    const root = workspaceRoot();
    expect(existsSync(join(root, 'apps/docs/src/app/live-zones.ts'))).toBe(true);
    for (const zone of Object.values(zones)) {
      expect(JSON.stringify(zone)).not.toMatch(/tak_|https?:\/\/api\./);
    }
  });

  it('a countdown ends in the future when built, so it always runs', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const zone = countdownZone(now) as { taleGroups: { tales: { document: { elements: { props: { endsAt: string } }[] } }[] }[] };
    const endsAt = zone.taleGroups[0].tales[0].document.elements[0].props.endsAt;
    expect(new Date(endsAt).getTime()).toBeGreaterThan(now.getTime());
  });
});
