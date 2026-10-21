import { join } from 'node:path';
import type { Db } from '@taleart/server-access';
import {
  FrameTypeRegistry,
  InvalidFrameSettingsError,
  loadFrameTypeRegistry,
  UnknownFrameTypeError,
} from './frame-types';
import { createFrame, findZone, FrameNotFoundError, listFrames, updateFrameSettings, ZoneNotFoundError } from './frames';

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
    expect(types[1].schema).toMatchObject({ type: 'object', properties: {} });
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

    it('leaves object settings of an unknown type as they are, and drops every key of a field-less type', () => {
      expect(registry.withDefaults('feed', { a: 1 })).toEqual({ a: 1 });
      expect(registry.withDefaults('banner', {})).toEqual({});
      expect(registry.withDefaults('banner', { stray: true })).toEqual({});
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

describe('frames', () => {
  const registry = new FrameTypeRegistry([
    { key: 'bar', label: 'Bar', schema: { type: 'object', properties: {}, additionalProperties: false } },
  ]);

  it('does not query for a zone id that is not a UUID', async () => {
    const query = vi.fn();
    await expect(listFrames({ query } as unknown as Db, 'nope')).rejects.toBeInstanceOf(ZoneNotFoundError);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses an unknown zone without inserting', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(
      createFrame({ query } as unknown as Db, registry, { zoneId, type: 'bar' }),
    ).rejects.toBeInstanceOf(ZoneNotFoundError);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).not.toMatch(/INSERT/);
  });

  it('refuses invalid settings without inserting', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ project_id: projectId }] });
    await expect(
      createFrame({ query } as unknown as Db, registry, { zoneId, type: 'bar', settings: { color: 'red' } }),
    ).rejects.toBeInstanceOf(InvalidFrameSettingsError);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).not.toMatch(/INSERT/);
  });

  it("copies the zone's project and stores missing settings as {}", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ project_id: projectId }] })
      .mockResolvedValueOnce({ rows: [{ id: 'f1' }] });
    await createFrame({ query } as unknown as Db, registry, { zoneId, type: 'bar' });
    expect(query.mock.calls[1][1]).toEqual([zoneId, projectId, 'bar', '{}']);
  });

  describe('updateFrameSettings', () => {
    const frameId = '00000000-0000-4000-8000-000000000003';
    const zoneRow = { rows: [{ project_id: projectId }] };

    it('refuses an unknown zone', async () => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      await expect(
        updateFrameSettings({ query } as unknown as Db, registry, { zoneId, frameId, settings: {} }),
      ).rejects.toBeInstanceOf(ZoneNotFoundError);
    });

    it('refuses a malformed frame id without querying for it', async () => {
      const query = vi.fn().mockResolvedValue(zoneRow);
      await expect(
        updateFrameSettings({ query } as unknown as Db, registry, { zoneId, frameId: 'nope', settings: {} }),
      ).rejects.toBeInstanceOf(FrameNotFoundError);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('refuses a frame that is not in the zone', async () => {
      const query = vi.fn().mockResolvedValueOnce(zoneRow).mockResolvedValueOnce({ rows: [] });
      await expect(
        updateFrameSettings({ query } as unknown as Db, registry, { zoneId, frameId, settings: {} }),
      ).rejects.toBeInstanceOf(FrameNotFoundError);
      expect(query.mock.calls[1][1]).toEqual([frameId, zoneId]);
    });

    it('refuses invalid settings without updating', async () => {
      const query = vi.fn().mockResolvedValueOnce(zoneRow).mockResolvedValueOnce({ rows: [{ type: 'bar' }] });
      await expect(
        updateFrameSettings({ query } as unknown as Db, registry, { zoneId, frameId, settings: { color: 'red' } }),
      ).rejects.toBeInstanceOf(InvalidFrameSettingsError);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('stores valid settings and returns the frame', async () => {
      const frame = { id: frameId, zoneId, projectId, type: 'bar', settings: {} };
      const query = vi
        .fn()
        .mockResolvedValueOnce(zoneRow)
        .mockResolvedValueOnce({ rows: [{ type: 'bar' }] })
        .mockResolvedValueOnce({ rows: [frame] });
      expect(await updateFrameSettings({ query } as unknown as Db, registry, { zoneId, frameId, settings: {} })).toBe(
        frame,
      );
      expect(query.mock.calls[2][0]).toMatch(/UPDATE frames/);
      expect(query.mock.calls[2][1]).toEqual([frameId, zoneId, '{}']);
    });
  });

  it('finds a zone by id, and null for an unknown or malformed id', async () => {
    const zone = { id: zoneId, name: 'Bar', projectId };
    expect(await findZone({ query: vi.fn().mockResolvedValue({ rows: [zone] }) } as unknown as Db, zoneId)).toEqual(zone);
    expect(await findZone({ query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Db, zoneId)).toBeNull();
    const query = vi.fn();
    expect(await findZone({ query } as unknown as Db, 'nope')).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
