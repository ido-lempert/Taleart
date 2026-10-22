import { createZoneRequestTemplateValues } from '../generated/api';
import { findTemplate, ZONE_TEMPLATES } from './templates';

describe('zone templates', () => {
  it('ships Stories bar, Promo banner and Blank with the presets of epic UX rework R5', () => {
    expect(ZONE_TEMPLATES.map((t) => [t.key, t.label])).toEqual([
      ['stories-bar', 'Stories bar'],
      ['promo-banner', 'Promo banner'],
      ['blank', 'Blank'],
    ]);
    expect(findTemplate('stories-bar')?.frame).toEqual({
      type: 'bar',
      settings: { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 },
    });
    expect(findTemplate('promo-banner')?.frame).toEqual({
      type: 'banner',
      settings: { aspectRatio: '3:1', autoplay: true, intervalSeconds: 5, showDots: true, loop: true },
    });
    expect(findTemplate('blank')?.frame).toBeNull();
  });

  it('matches the template enum of CreateZoneRequest in the OpenAPI document', () => {
    expect(ZONE_TEMPLATES.map((t) => t.key)).toEqual([...createZoneRequestTemplateValues]);
  });

  it('gives every template a description and at most one display, and no theme', () => {
    for (const template of ZONE_TEMPLATES) {
      expect(template.description.trim()).not.toBe('');
      if (template.frame) expect(['bar', 'banner']).toContain(template.frame.type);
      expect(Object.keys(template)).not.toContain('theme');
    }
  });

  it('finds a template by its exact key only', () => {
    expect(findTemplate('promo-banner')?.label).toBe('Promo banner');
    for (const key of ['nope', 'home-stories-bar', 'Promo-Banner', ' blank', '', 3, null, undefined]) {
      expect(findTemplate(key)).toBeUndefined();
    }
  });
});
