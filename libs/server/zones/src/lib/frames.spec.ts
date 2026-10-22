import { join } from 'node:path';
import type { Db } from '@taleart/server-access';
import {
  FrameTypeRegistry,
  InvalidFrameSettingsError,
  loadFrameTypeRegistry,
  UnknownFrameTypeError,
} from './frame-types';
import {
  DisplayConcurrentChangeError,
  DisplayExistsError,
  DisplayNotFoundError,
  EmptyDisplayChangeError,
  findZone,
  setDisplay,
  updateDisplay,
  ZoneNotFoundError,
} from './frames';

const shippedDir = join(__dirname, '../../../../contract/frame-types');
const zoneId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';

describe('frame-type registry', () => {
  it('ships bar and banner, each with its settings schema', () => {
    const types = loadFrameTypeRegistry(shippedDir).list();
    expect(types.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'bar', label: 'Bar' },
      { key: 'banner', label: 'Banner' },
    ]);
    expect(Object.keys((types[0].schema as { properties: object }).properties)).toEqual([
      'shape',
      'size',
      'showTitles',
      'alignment',
      'gap',
    ]);
    expect(Object.keys((types[1].schema as { properties: object }).properties)).toEqual([
      'aspectRatio',
      'autoplay',
      'intervalSeconds',
      'showDots',
      'loop',
    ]);
  });

  it('refuses unknown settings fields on bar and banner', () => {
    const registry = loadFrameTypeRegistry(shippedDir);
    for (const type of ['bar', 'banner']) {
      expect(() => registry.validate(type, {})).not.toThrow();
      expect(() => registry.validate(type, { color: 'red' })).toThrow(/color/);
    }
  });

  describe('bar settings', () => {
    const registry = loadFrameTypeRegistry(shippedDir);

    it('accepts every R2 value', () => {
      const valid = { shape: 'rounded-square', size: 'large', showTitles: false, alignment: 'center', gap: 20 };
      expect(() => registry.validate('bar', valid)).not.toThrow();
      for (const gap of [4, 24]) expect(() => registry.validate('bar', { gap })).not.toThrow();
      for (const size of ['small', 'medium']) expect(() => registry.validate('bar', { size })).not.toThrow();
    });

    it.each([
      [{ gap: 40 }, 'settings.gap must be at most 24'],
      [{ gap: 3 }, 'settings.gap must be at least 4'],
      [{ gap: 12.5 }, 'settings.gap must be integer'],
      [{ gap: '12' }, 'settings.gap must be integer'],
      [{ shape: 'star' }, 'settings.shape must be one of: circle, rounded-square'],
      [{ size: 'huge' }, 'settings.size must be one of: small, medium, large'],
      [{ alignment: 'end' }, 'settings.alignment must be one of: start, center'],
      [{ showTitles: 'no' }, 'settings.showTitles must be boolean'],
    ])('refuses %j with "%s"', (settings, message) => {
      expect(() => registry.validate('bar', settings)).toThrow(new InvalidFrameSettingsError(message));
    });

    it('fills each missing field with its schema default, keeping stored values', () => {
      expect(registry.withDefaults('bar', {})).toEqual({
        shape: 'circle',
        size: 'medium',
        showTitles: true,
        alignment: 'start',
        gap: 12,
      });
      expect(registry.withDefaults('bar', { gap: 20, showTitles: false })).toMatchObject({
        gap: 20,
        showTitles: false,
        shape: 'circle',
      });
    });

    it('replaces each invalid stored value with its default and drops unknown keys', () => {
      expect(
        registry.withDefaults('bar', { gap: 40, shape: 'star', size: 'large', showTitles: 'no', color: 'red' }),
      ).toEqual({ shape: 'circle', size: 'large', showTitles: true, alignment: 'start', gap: 12 });
      expect(registry.withDefaults('bar', { gap: 12.5, alignment: null })).toMatchObject({ gap: 12, alignment: 'start' });
    });

    it.each([null, ['x'], 'bar', 7])('reads stored settings %j that are not an object as {}', (stored) => {
      expect(registry.withDefaults('bar', stored)).toEqual(registry.withDefaults('bar', {}));
      expect(registry.withDefaults('feed', stored)).toEqual({});
    });

    it('leaves object settings of an unknown type as they are', () => {
      expect(registry.withDefaults('feed', { a: 1 })).toEqual({ a: 1 });
    });
  });

  describe('banner settings', () => {
    const registry = loadFrameTypeRegistry(shippedDir);
    const defaults = { aspectRatio: '16:9', autoplay: true, intervalSeconds: 5, showDots: true, loop: true };

    it('accepts every R3 value', () => {
      const valid = { aspectRatio: '3:1', autoplay: false, intervalSeconds: 3, showDots: false, loop: false };
      expect(() => registry.validate('banner', valid)).not.toThrow();
      for (const intervalSeconds of [3, 15]) expect(() => registry.validate('banner', { intervalSeconds })).not.toThrow();
      for (const aspectRatio of ['16:9', '1:1']) expect(() => registry.validate('banner', { aspectRatio })).not.toThrow();
    });

    it.each([
      [{ intervalSeconds: 16 }, 'settings.intervalSeconds must be at most 15'],
      [{ intervalSeconds: 2 }, 'settings.intervalSeconds must be at least 3'],
      [{ intervalSeconds: 4.5 }, 'settings.intervalSeconds must be integer'],
      [{ aspectRatio: '4:3' }, 'settings.aspectRatio must be one of: 16:9, 3:1, 1:1'],
      [{ autoplay: 'yes' }, 'settings.autoplay must be boolean'],
      [{ showDots: 1 }, 'settings.showDots must be boolean'],
      [{ loop: null }, 'settings.loop must be boolean'],
    ])('refuses %j with "%s"', (settings, message) => {
      expect(() => registry.validate('banner', settings)).toThrow(new InvalidFrameSettingsError(message));
    });

    it('fills defaults, keeps valid stored values, replaces invalid ones and drops unknown keys', () => {
      expect(registry.withDefaults('banner', {})).toEqual(defaults);
      expect(registry.withDefaults('banner', { aspectRatio: '3:1', showDots: false })).toEqual({
        ...defaults,
        aspectRatio: '3:1',
        showDots: false,
      });
      expect(
        registry.withDefaults('banner', { intervalSeconds: 40, aspectRatio: '<b>', loop: false, stray: true }),
      ).toEqual({ ...defaults, loop: false });
    });
  });

  it('refuses an unknown type', () => {
    expect(() => loadFrameTypeRegistry(shippedDir).validate('carousel', {})).toThrow(UnknownFrameTypeError);
  });

  it('validates a registered type against its schema', () => {
    const registry = new FrameTypeRegistry([
      {
        key: 'strip',
        label: 'Strip',
        schema: { type: 'object', required: ['height'], properties: { height: { type: 'integer' } } },
      },
    ]);
    expect(() => registry.validate('strip', {})).toThrow(InvalidFrameSettingsError);
    expect(() => registry.validate('strip', {})).toThrow(/height/);
    expect(() => registry.validate('strip', { height: 'tall' })).toThrow(/settings\.height/);
    expect(() => registry.validate('strip', { height: 4 })).not.toThrow();
  });

  it('refuses a key registered twice', () => {
    const schema = { type: 'object' };
    expect(
      () =>
        new FrameTypeRegistry([
          { key: 'bar', label: 'Bar', schema },
          { key: 'bar', label: 'Bar again', schema },
        ]),
    ).toThrow(/twice/);
  });
});

describe('display', () => {
  const registry = new FrameTypeRegistry([
    {
      key: 'bar',
      label: 'Bar',
      schema: { type: 'object', properties: { gap: { type: 'integer', default: 12 } }, additionalProperties: false },
    },
    {
      key: 'banner',
      label: 'Banner',
      schema: { type: 'object', properties: { loop: { type: 'boolean', default: true } }, additionalProperties: false },
    },
  ]);
  const zoneRow = { rows: [{ project_id: projectId }] };
  const frameId = '00000000-0000-4000-8000-000000000003';

  it('does not query for a zone id that is not a UUID', async () => {
    const query = vi.fn();
    await expect(setDisplay({ query } as unknown as Db, registry, { zoneId: 'nope', type: 'bar' })).rejects.toBeInstanceOf(
      ZoneNotFoundError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses an unknown zone, an unknown type and invalid settings without inserting', async () => {
    const none = vi.fn().mockResolvedValue({ rows: [] });
    await expect(setDisplay({ query: none } as unknown as Db, registry, { zoneId, type: 'bar' })).rejects.toBeInstanceOf(
      ZoneNotFoundError,
    );
    const query = vi.fn().mockResolvedValue(zoneRow);
    await expect(
      setDisplay({ query } as unknown as Db, registry, { zoneId, type: 'bar', settings: { color: 'red' } }),
    ).rejects.toBeInstanceOf(InvalidFrameSettingsError);
    await expect(setDisplay({ query } as unknown as Db, registry, { zoneId, type: 'strip' })).rejects.toBeInstanceOf(
      UnknownFrameTypeError,
    );
    expect(query.mock.calls.some(([sql]) => /INSERT/.test(sql))).toBe(false);
  });

  it("copies the zone's project, stores the type's defaults when settings are missing, and inserts only into an empty zone", async () => {
    const query = vi.fn().mockResolvedValueOnce(zoneRow).mockResolvedValueOnce({ rows: [{ id: 'f1' }] });
    await setDisplay({ query } as unknown as Db, registry, { zoneId, type: 'bar' });
    expect(query.mock.calls[1][0]).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM frames WHERE zone_id = \$1\)/);
    expect(query.mock.calls[1][1]).toEqual([zoneId, projectId, 'bar', '{"gap":12}']);
  });

  it('refuses a second display', async () => {
    const query = vi.fn().mockResolvedValueOnce(zoneRow).mockResolvedValueOnce({ rows: [] });
    await expect(setDisplay({ query } as unknown as Db, registry, { zoneId, type: 'bar' })).rejects.toBeInstanceOf(
      DisplayExistsError,
    );
  });

  describe('updateDisplay', () => {
    const display = { rows: [{ id: frameId, type: 'bar' }] };

    it('refuses an unknown zone, an empty change and a zone without a display', async () => {
      const none = vi.fn().mockResolvedValue({ rows: [] });
      await expect(updateDisplay({ query: none } as unknown as Db, registry, { zoneId, settings: {} })).rejects.toBeInstanceOf(
        ZoneNotFoundError,
      );
      const query = vi
        .fn()
        .mockResolvedValueOnce(zoneRow)
        .mockResolvedValueOnce(zoneRow)
        .mockResolvedValueOnce({ rows: [] });
      await expect(updateDisplay({ query } as unknown as Db, registry, { zoneId })).rejects.toBeInstanceOf(
        EmptyDisplayChangeError,
      );
      await expect(updateDisplay({ query } as unknown as Db, registry, { zoneId, type: 'bar' })).rejects.toBeInstanceOf(
        DisplayNotFoundError,
      );
    });

    it("resets the settings to the new type's defaults when the type changes", async () => {
      const query = vi
        .fn()
        .mockResolvedValueOnce(zoneRow)
        .mockResolvedValueOnce(display)
        .mockResolvedValueOnce({ rows: [{}] });
      await updateDisplay({ query } as unknown as Db, registry, { zoneId, type: 'banner' });
      expect(query.mock.calls[2][0]).toMatch(/UPDATE frames SET type = \$2, settings = \$3/);
      expect(query.mock.calls[2][1]).toEqual([frameId, 'banner', '{"loop":true}', 'bar']);
    });

    it('validates settings against the new type, and writes nothing when they do not match', async () => {
      const query = vi.fn().mockResolvedValueOnce(zoneRow).mockResolvedValueOnce(display);
      await expect(
        updateDisplay({ query } as unknown as Db, registry, { zoneId, type: 'banner', settings: { gap: 4 } }),
      ).rejects.toBeInstanceOf(InvalidFrameSettingsError);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('stores new settings and keeps the type', async () => {
      const frame = { id: frameId, zoneId, projectId, type: 'bar', settings: { gap: 4 } };
      const query = vi
        .fn()
        .mockResolvedValueOnce(zoneRow)
        .mockResolvedValueOnce(display)
        .mockResolvedValueOnce({ rows: [frame] });
      expect(await updateDisplay({ query } as unknown as Db, registry, { zoneId, settings: { gap: 4 } })).toBe(frame);
      expect(query.mock.calls[2][1]).toEqual([frameId, 'bar', '{"gap":4}', 'bar']);
    });

    it('writes only while the display still has the type it read, checking again once, then refuses', async () => {
      const banner = { rows: [{ id: frameId, type: 'banner' }] };
      const saved = { id: frameId, zoneId, projectId, type: 'banner', settings: {} };
      // The type switched to banner between the read and the write: the settings are checked again against banner.
      const query = vi
        .fn()
        .mockResolvedValueOnce(zoneRow)
        .mockResolvedValueOnce(display)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(banner)
        .mockResolvedValueOnce({ rows: [saved] });
      expect(await updateDisplay({ query } as unknown as Db, registry, { zoneId, settings: {} })).toBe(saved);
      expect(query.mock.calls[2][0]).toMatch(/WHERE id = \$1 AND type = \$4/);
      expect(query.mock.calls[2][1]).toEqual([frameId, 'bar', '{}', 'bar']);
      expect(query.mock.calls[4][1]).toEqual([frameId, 'banner', '{}', 'banner']);

      // Settings for a bar on a display that became a banner are refused, nothing written.
      const switched = vi
        .fn()
        .mockResolvedValueOnce(zoneRow)
        .mockResolvedValueOnce(display)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(banner);
      await expect(
        updateDisplay({ query: switched } as unknown as Db, registry, { zoneId, settings: { gap: 4 } }),
      ).rejects.toBeInstanceOf(InvalidFrameSettingsError);

      // Two misses in a row: a concurrent change.
      const busy = vi
        .fn()
        .mockResolvedValueOnce(zoneRow)
        .mockResolvedValueOnce(display)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(display)
        .mockResolvedValueOnce({ rows: [] });
      await expect(
        updateDisplay({ query: busy } as unknown as Db, registry, { zoneId, settings: { gap: 4 } }),
      ).rejects.toBeInstanceOf(DisplayConcurrentChangeError);
    });

    it('changes nothing for the same type without settings', async () => {
      const frame = { id: frameId, zoneId, projectId, type: 'bar', settings: { gap: 4 } };
      const query = vi
        .fn()
        .mockResolvedValueOnce(zoneRow)
        .mockResolvedValueOnce(display)
        .mockResolvedValueOnce({ rows: [frame] });
      expect(await updateDisplay({ query } as unknown as Db, registry, { zoneId, type: 'bar' })).toBe(frame);
      expect(query.mock.calls[2][0]).not.toMatch(/UPDATE/);
    });
  });

  it('finds a zone by id, and null for an unknown or malformed id', async () => {
    const zone = { id: zoneId, name: 'Bar', slug: 'bar', projectId, playbookKey: null, frame: null };
    expect(await findZone({ query: vi.fn().mockResolvedValue({ rows: [zone] }) } as unknown as Db, zoneId)).toEqual(zone);
    expect(await findZone({ query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Db, zoneId)).toBeNull();
    const query = vi.fn();
    expect(await findZone({ query } as unknown as Db, 'nope')).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
