import { findPlaybook, PLAYBOOKS } from './playbooks';

describe('playbooks', () => {
  it('ships the two MVP presets with the display and settings of epic web zones R8', () => {
    expect(PLAYBOOKS.map((p) => [p.key, p.label])).toEqual([
      ['home-stories-bar', 'Home page stories bar'],
      ['promo-banner', 'Promo banner'],
    ]);
    expect(findPlaybook('home-stories-bar')?.frame).toEqual({
      type: 'bar',
      settings: { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 },
    });
    expect(findPlaybook('promo-banner')?.frame).toEqual({
      type: 'banner',
      settings: { aspectRatio: '3:1', autoplay: true, intervalSeconds: 5, showDots: true, loop: true },
    });
  });

  it('gives every playbook a goal and one display, and no theme', () => {
    expect(new Set(PLAYBOOKS.map((p) => p.key)).size).toBe(PLAYBOOKS.length);
    for (const playbook of PLAYBOOKS) {
      expect(playbook.goal.trim()).not.toBe('');
      expect(['bar', 'banner']).toContain(playbook.frame.type);
      expect(Object.keys(playbook)).not.toContain('theme');
    }
  });

  it('finds a playbook by its exact key only', () => {
    expect(findPlaybook('promo-banner')?.label).toBe('Promo banner');
    for (const key of ['nope', 'Promo-Banner', ' promo-banner', '', 3, null, undefined]) {
      expect(findPlaybook(key)).toBeUndefined();
    }
  });
});
