import { isStageKey } from '../index';
import { findPlaybook, PLAYBOOKS } from './playbooks';

describe('playbooks', () => {
  it('ships the two MVP presets with the frames and settings of epic web zones R8', () => {
    expect(PLAYBOOKS.map((p) => [p.key, p.label])).toEqual([
      ['home-stories-bar', 'Home page stories bar'],
      ['promo-banner', 'Promo banner'],
    ]);
    expect(findPlaybook('home-stories-bar')?.frames).toEqual([
      {
        type: 'bar',
        settings: { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 },
        stage: { key: 'home-stories-bar', name: 'Home page stories bar' },
      },
    ]);
    expect(findPlaybook('promo-banner')?.frames).toEqual([
      {
        type: 'banner',
        settings: { aspectRatio: '3:1', autoplay: true, intervalSeconds: 5, showDots: true, loop: true },
        stage: { key: 'promo-banner', name: 'Promo banner' },
      },
    ]);
  });

  it('gives every playbook a goal and frames, with valid stage keys unique within it, and no theme', () => {
    expect(new Set(PLAYBOOKS.map((p) => p.key)).size).toBe(PLAYBOOKS.length);
    for (const playbook of PLAYBOOKS) {
      expect(playbook.goal.trim()).not.toBe('');
      expect(playbook.frames.length).toBeGreaterThan(0);
      const keys = playbook.frames.map((f) => f.stage.key);
      expect(keys.every(isStageKey)).toBe(true);
      expect(new Set(keys).size).toBe(keys.length);
      expect(playbook.frames.every((f) => f.stage.name.trim() !== '')).toBe(true);
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
