import { join } from 'node:path';
import { ZONE_TEMPLATES, type ZoneTemplate } from '@taleart/contract';
import type { TransactionalDb } from '@taleart/server-access';
import { InvalidFrameSettingsError, loadFrameTypeRegistry } from './frame-types';
import { createZoneFromTemplate, UnknownTemplateError } from './templates';

const zoneId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const frameId = '00000000-0000-4000-8000-000000000003';

// The shipped frame-type registry, as the API loads it.
const registry = loadFrameTypeRegistry(join(__dirname, '../../../../contract/frame-types'));

/** A fake pool: the project exists, every slug is free. Every statement, on the pool or a transaction's connection, lands in `sql`. */
function fakeDb() {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    sql.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
    params.push(values);
    if (/FROM projects/.test(text)) return { rowCount: 1, rows: [{}] };
    if (/^SELECT project_id FROM zones/.test(text.trim())) return { rows: [{ project_id: projectId }] };
    if (/^INSERT INTO zones/.test(text.trim())) {
      return {
        rows: [{ id: zoneId, name: values[0], projectId, slug: values[2], createdFromTemplate: values[3], frame: null }],
      };
    }
    if (/^INSERT INTO frames/.test(text.trim())) {
      return { rows: [{ id: frameId, zoneId, projectId, type: values[2], settings: JSON.parse(values[3] as string) }] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { db: { query, connect } as unknown as TransactionalDb, sql, params, connect, release };
}

describe('createZoneFromTemplate', () => {
  it('ships presets whose settings the frame-type registry accepts', () => {
    for (const { frame } of ZONE_TEMPLATES) {
      if (frame) expect(() => registry.validate(frame.type, frame.settings)).not.toThrow();
    }
  });

  it('creates the zone and its preset display in one transaction, and records the note', async () => {
    for (const template of ZONE_TEMPLATES.filter((t) => t.frame)) {
      const fake = fakeDb();
      const zone = await createZoneFromTemplate(fake.db, registry, { name: 'Home', projectId, template: template.key });
      expect(zone.createdFromTemplate).toBe(template.key);
      expect(zone.frame).toEqual({ id: frameId, zoneId, projectId, ...template.frame });
      expect(fake.connect).toHaveBeenCalledTimes(1);
      expect(fake.sql[0]).toBe('BEGIN');
      expect(fake.sql.at(-1)).toBe('COMMIT');
      expect(fake.sql).toContain('INSERT INTO frames');
    }
  });

  it('creates a Blank zone with the note and no display, without a transaction', async () => {
    const fake = fakeDb();
    const zone = await createZoneFromTemplate(fake.db, registry, { name: 'Home', projectId, template: 'blank' });
    expect(zone).toMatchObject({ createdFromTemplate: 'blank', frame: null });
    expect(fake.connect).not.toHaveBeenCalled();
    expect(fake.sql).not.toContain('INSERT INTO frames');
  });

  it('creates a zone without a note when no template is given', async () => {
    const fake = fakeDb();
    const zone = await createZoneFromTemplate(fake.db, registry, { name: 'Home', projectId });
    expect(zone).toMatchObject({ createdFromTemplate: null, frame: null });
  });

  it('refuses a key not in the registry before writing anything', async () => {
    for (const template of ['nope', 'home-stories-bar', '', 3, null]) {
      const fake = fakeDb();
      await expect(createZoneFromTemplate(fake.db, registry, { name: 'Home', projectId, template })).rejects.toBeInstanceOf(
        UnknownTemplateError,
      );
      expect(fake.sql).toEqual([]);
    }
  });

  it('rolls the zone back when the display is refused', async () => {
    const broken: ZoneTemplate[] = [
      { key: 'stories-bar', label: 'Broken', description: 'x', frame: { type: 'bar', settings: { gap: -5 } as never } },
    ];
    const fake = fakeDb();
    await expect(
      createZoneFromTemplate(fake.db, registry, { name: 'Home', projectId, template: 'stories-bar' }, broken),
    ).rejects.toBeInstanceOf(InvalidFrameSettingsError);
    expect(fake.sql).toContain('INSERT INTO zones');
    expect(fake.sql.at(-1)).toBe('ROLLBACK');
    expect(fake.sql).not.toContain('COMMIT');
    expect(fake.release).toHaveBeenCalledTimes(1);
  });
});
