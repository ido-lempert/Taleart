import type { Zone } from '@taleart/contract/core';
import { showsSetup, zoneInstalled, zoneSetupSteps, zoneTab } from './zone-setup';

const frame = { id: 'f1', zoneId: 'z1', projectId: 'p1', type: 'bar', settings: {} } as Zone['frame'];
const reasons = (...codes: string[]) =>
  ({ visible: codes.length === 0, reasons: codes.map((code) => ({ code, subject: 'zone' })) }) as Zone['visibility'];

describe('zone setup (epic UX rework R9)', () => {
  it('reads the tab from the URL value, the default for none or an unknown one', () => {
    expect(zoneTab('display')).toBe('display');
    expect(zoneTab('install')).toBe('install');
    expect(zoneTab('groups')).toBe('groups');
    expect(zoneTab(undefined)).toBe('groups');
    expect(zoneTab(null)).toBe('groups');
    expect(zoneTab('Display')).toBe('groups');
  });

  it('ticks each step from the zone reasons', () => {
    const done = (zone: Pick<Zone, 'frame' | 'visibility'>) => zoneSetupSteps(zone).map((s) => [s.id, s.done]);
    expect(done({ frame: null, visibility: reasons('zone-no-display', 'zone-not-installed', 'no-tale-groups') })).toEqual([
      ['display', false],
      ['install', false],
      ['group', false],
    ]);
    expect(done({ frame, visibility: reasons('zone-not-installed', 'no-visible-groups') })).toEqual([
      ['display', true],
      ['install', false],
      ['group', false],
    ]);
    expect(done({ frame: null, visibility: reasons('zone-no-display') })).toEqual([
      ['display', false],
      ['install', true],
      ['group', true],
    ]);
    expect(done({ frame, visibility: reasons() })).toEqual([
      ['display', true],
      ['install', true],
      ['group', true],
    ]);
  });

  it('leaves the reason-based steps open while the visibility is unknown', () => {
    const zone = { frame, visibility: undefined } as unknown as Pick<Zone, 'frame' | 'visibility'>;
    expect(zoneSetupSteps(zone).map((s) => s.done)).toEqual([true, false, false]);
    expect(zoneInstalled(zone)).toBeNull();
  });

  it('sends each step to its tab', () => {
    expect(zoneSetupSteps({ frame: null, visibility: reasons() }).map((s) => s.tab)).toEqual([
      'display',
      'install',
      'groups',
    ]);
  });

  it('shows the checklist only until the zone is first visible', () => {
    expect(showsSetup({ firstVisibleAt: null, visibility: reasons('no-tale-groups') })).toBe(true);
    expect(showsSetup({ firstVisibleAt: null, visibility: reasons() })).toBe(false);
    expect(showsSetup({ firstVisibleAt: '2026-10-22T10:00:00.000Z', visibility: reasons('group-off') })).toBe(false);
  });

  it('says installed from the zone-not-installed reason', () => {
    expect(zoneInstalled({ visibility: reasons('zone-not-installed') })).toBe(false);
    expect(zoneInstalled({ visibility: reasons('no-tale-groups') })).toBe(true);
  });
});
