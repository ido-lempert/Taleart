import type { ProjectFont, Zone, ZoneTaleGroup } from '@taleart/contract/core';
import type { TaleDocument } from '@taleart/contract/tale-document';
import { groupPreviewZone, previewPublishedTaleIds, type GroupPreviewSource } from './tale-preview-group';

// Tale Studio story 7.10 (R10, AD-16): the group preview's zone is the zone as the Delivery API would send it.

const box = { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 };
const doc = (text: string, extra: Record<string, unknown> = {}): TaleDocument =>
  ({
    version: 1,
    canvas: { background: { type: 'color', color: '#112233' } },
    elements: [
      { id: 'txt', type: 'text', box, a11y: {}, hidden: false, locked: false, props: { text } },
      { id: 'hid', type: 'text', box, a11y: {}, hidden: true, locked: false, props: { text: 'Hidden layer' } },
    ],
    ...extra,
  }) as unknown as TaleDocument;
const visible = (value: boolean) => ({ visible: value, reasons: value ? [] : ['not-live'] });
const tale = (id: string, title: string, shown = true, media: unknown = null) =>
  ({
    id,
    taleGroupId: 'g',
    projectId: 'p1',
    title,
    position: 0,
    status: 'live',
    storedStatus: 'live',
    startsAt: null,
    endsAt: null,
    media,
    visibility: visible(shown),
  }) as unknown as ZoneTaleGroup['tales'][number];
const group = (id: string, name: string, tales: ZoneTaleGroup['tales'], shown = true, cover: unknown = null) =>
  ({
    id,
    name,
    projectId: 'p1',
    status: 'live',
    storedStatus: 'live',
    startsAt: null,
    endsAt: null,
    cover,
    zoneIds: ['z1'],
    tales,
    tags: [],
    tagMatch: 'any',
    userLists: [],
    audience: null,
    visibility: visible(shown),
    position: 0,
  }) as unknown as ZoneTaleGroup;
const frame = { id: 'f1', zoneId: 'z1', projectId: 'p1', type: 'bar', settings: { layout: 'chip' } };
const zone = (withFrame = true): Zone =>
  ({ id: 'z1', name: 'Home', slug: 'home', projectId: 'p1', frame: withFrame ? frame : null }) as unknown as Zone;
const FONT_ID = 'b1a2c3d4-0000-4000-8000-000000000001';
const FONT = { id: FONT_ID, family: 'Brand', weight: 700, style: 'normal' } as unknown as ProjectFont;
const UNUSED_FONT = {
  id: 'b1a2c3d4-0000-4000-8000-000000000002',
  family: 'Unused',
  weight: 400,
  style: 'normal',
} as unknown as ProjectFont;

function source(overrides: Partial<GroupPreviewSource> = {}): GroupPreviewSource {
  return {
    projectId: 'p1',
    zone: zone(),
    groups: [
      group('g1', 'Summer', [
        tale('t1', 'Beach'),
        tale('t2', 'Sea'),
        tale('t3', 'Unpublished'),
        tale('t4', 'Hidden', false),
      ]),
      group('g2', 'Winter', [tale('t5', 'Snow')]),
      group('g3', 'Archive', [tale('t6', 'Old')], false),
    ],
    groupId: 'g1',
    taleId: 't1',
    draft: doc('Draft text', { durationMs: 4000 }),
    published: new Map<string, TaleDocument | null>([
      ['t2', doc('Published sea')],
      ['t3', null],
      ['t4', doc('Hidden on the site')],
      ['t5', doc('Snow')],
      ['t6', doc('Archived')],
    ]),
    theme: { accentColor: '#ff8800' },
    fonts: [FONT, UNUSED_FONT],
    ...overrides,
  };
}

describe('groupPreviewZone', () => {
  it('is null for a zone with no display, which shows no group to a visitor', () => {
    expect(groupPreviewZone(source({ zone: zone(false) }))).toBeNull();
  });

  it('carries the zone, its theme and its display as the Delivery API sends them', () => {
    const delivered = groupPreviewZone(source())!;
    expect(delivered).toMatchObject({ id: 'z1', name: 'Home', slug: 'home', theme: { accentColor: '#ff8800' } });
    expect(delivered.frame).toEqual({ id: 'f1', type: 'bar', settings: { layout: 'chip' } });
  });

  it('draws the tale being edited from its draft, and the other tales from their published documents', () => {
    const [summer] = groupPreviewZone(source())!.taleGroups;
    expect(summer.tales.map((t) => t.id)).toEqual(['t1', 't2']);
    const [edited, published] = summer.tales;
    expect(edited.title).toBe('Beach');
    expect(edited.document!.elements.map((e) => e.id)).toEqual(['txt']);
    expect((edited.document!.elements[0] as unknown as { props: { text: string } }).props.text).toBe('Draft text');
    expect(edited.document!.durationMs).toBe(4000);
    expect((published.document!.elements[0] as unknown as { props: { text: string } }).props.text).toBe(
      'Published sea',
    );
  });

  it('leaves out tales that are not visible or have no published document, and groups that are not visible', () => {
    const names = groupPreviewZone(source())!.taleGroups.map((g) => g.name);
    expect(names).toEqual(['Summer', 'Winter']);
    const summer = groupPreviewZone(source())!.taleGroups[0];
    expect(summer.tales.map((t) => t.id)).not.toContain('t3');
    expect(summer.tales.map((t) => t.id)).not.toContain('t4');
  });

  it('keeps the group being edited even when it is not visible on the site', () => {
    const hidden = source({
      groupId: 'g3',
      taleId: 't6',
      draft: doc('Draft archive'),
      groups: [group('g3', 'Archive', [tale('t6', 'Old')], false)],
    });
    const archive = groupPreviewZone(hidden)!.taleGroups[0];
    expect(archive.name).toBe('Archive');
    expect(archive.tales.map((t) => t.id)).toEqual(['t6']);
  });

  it('gives each group its cover and each tale its media, as absolute URLs on the dashboard origin', () => {
    const cover = { kind: 'image', contentType: 'image/png', animated: false, url: '/api/v1/tale-groups/g1/cover' };
    const picture = { kind: 'image', contentType: 'image/png', url: '/api/v1/tales/t1/media' };
    const delivered = groupPreviewZone(
      source({ groups: [group('g1', 'Summer', [tale('t1', 'Beach', true, picture)], true, cover)] }),
    )!;
    const [summer] = delivered.taleGroups;
    expect(summer.cover).toEqual({ ...cover, url: new URL(cover.url, location.href).href });
    expect(summer.tales[0].media).toEqual({
      kind: 'image',
      contentType: 'image/png',
      url: new URL(picture.url, location.href).href,
    });
  });

  it('gives each tale only the project fonts its document uses', () => {
    const delivered = groupPreviewZone(source())!;
    expect(delivered.taleGroups[0].tales[0].fonts).toEqual([]);
    const fontDoc = {
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [
        {
          id: 'f',
          type: 'text',
          box,
          a11y: {},
          hidden: false,
          locked: false,
          props: { text: 'x', font: { source: 'project', fontId: FONT_ID } },
        },
      ],
    } as unknown as TaleDocument;
    const [first] = groupPreviewZone(source({ draft: fontDoc }))!.taleGroups[0].tales;
    expect(first.fonts!.map((f) => f.id)).toEqual([FONT_ID]);
    expect(first.fonts![0].url).toBe(new URL(`/api/v1/projects/p1/fonts/${FONT_ID}/file`, location.href).href);
  });
});

describe('previewPublishedTaleIds', () => {
  it('names the visible tales of the visible groups, but not the tale being edited nor a hidden tale', () => {
    // Summer (visible, its hidden tale t4 left out) and Winter are read; Archive, not visible, is not.
    expect(previewPublishedTaleIds(source().groups, 'g1', 't1')).toEqual(['t2', 't3', 't5']);
  });

  it('reads the tales of the group being edited too, even when it is not visible', () => {
    expect(previewPublishedTaleIds(source().groups, 'g3', 't1')).toEqual(['t2', 't3', 't5', 't6']);
  });
});
