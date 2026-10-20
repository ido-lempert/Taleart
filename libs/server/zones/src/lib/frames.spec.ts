import { join } from 'node:path';
import type { Db } from '@taleart/server-access';
import {
  FrameTypeRegistry,
  InvalidFrameSettingsError,
  loadFrameTypeRegistry,
  UnknownFrameTypeError,
} from './frame-types';
import { createFrame, listFrames, ZoneNotFoundError } from './frames';

const shippedDir = join(__dirname, '../../../../contract/frame-types');
const zoneId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';

describe('frame-type registry', () => {
  it('ships bar and banner', () => {
    expect(loadFrameTypeRegistry(shippedDir).list()).toEqual([
      { key: 'bar', label: 'Bar' },
      { key: 'banner', label: 'Banner' },
    ]);
  });

  it('gives bar and banner no settings fields yet', () => {
    const registry = loadFrameTypeRegistry(shippedDir);
    for (const type of ['bar', 'banner']) {
      expect(() => registry.validate(type, {})).not.toThrow();
      expect(() => registry.validate(type, { color: 'red' })).toThrow(/color/);
    }
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
});
