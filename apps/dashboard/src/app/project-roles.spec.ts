import type { ProjectAuditEntry } from '@taleart/contract/core';
import {
  accessText,
  describeAudit,
  describeRole,
  gateMenu,
  menuPermission,
  roleMatrixRows,
  roleWithArticle,
  shortDate,
} from './project-roles';

const entry = (over: Partial<ProjectAuditEntry>): ProjectAuditEntry => ({
  id: 'a1',
  action: 'role_changed',
  actorId: 'u1',
  actorName: 'Dana Levi',
  targetUserId: 'u2',
  targetEmail: 'sam@example.com',
  detail: {},
  createdAt: '2026-10-20T09:00:00.000Z',
  ...over,
});
const names = (id: string) => ({ u2: 'Sam Cohen', u3: 'Kim Park' })[id];

describe('role wording', () => {
  it('describes each role from the shared matrix in plain words', () => {
    expect(describeRole('viewer')).toBe(
      'Viewer: see everything (analytics included). Cannot change content, publish, manage zones, manage keys or manage the team.',
    );
    expect(describeRole('editor')).toBe(
      'Editor: see everything (analytics included) and edit content and save drafts. Cannot publish, manage zones, manage keys or manage the team.',
    );
    expect(describeRole('publisher')).toBe(
      'Publisher: see everything (analytics included), edit content and save drafts, publish content and manage zones. Cannot manage keys or manage the team.',
    );
    expect(describeRole('admin')).toBe(
      'Admin: see everything (analytics included), edit content and save drafts, publish content, manage zones, manage keys and manage the team.',
    );
  });

  it('puts the right article before a role', () => {
    expect(roleWithArticle('editor')).toBe('an Editor');
    expect(roleWithArticle('admin')).toBe('an Admin');
    expect(roleWithArticle('publisher')).toBe('a Publisher');
    expect(roleWithArticle('viewer')).toBe('a Viewer');
  });

  it('builds the matrix rows: viewer lowest, admin everything', () => {
    const rows = roleMatrixRows();
    expect(rows).toHaveLength(7);
    const edit = rows.find((r) => r.permission === 'content.edit');
    expect(edit?.roles).toEqual({ viewer: false, editor: true, publisher: true, admin: true });
    expect(rows.every((r) => r.roles.admin)).toBe(true);
    expect(rows.find((r) => r.permission === 'members.manage')?.roles.publisher).toBe(false);
  });

  it('writes access and dates', () => {
    expect(shortDate('2026-12-12T23:59:59.000Z')).toBe('12 Dec 2026');
    expect(accessText(null, false)).toBe('Permanent');
    expect(accessText('2026-12-12T23:59:59.000Z', false)).toBe('Until 12 Dec 2026');
    expect(accessText('2026-10-01T23:59:59.000Z', true)).toBe('Expired 1 Oct 2026');
  });
});

describe('audit sentences', () => {
  it('reads a role change with the target by name', () => {
    expect(describeAudit(entry({ detail: { from: 'editor', to: 'publisher' } }), names)).toBe(
      'Dana Levi changed Sam Cohen from Editor to Publisher',
    );
  });

  it('falls back to the email, then to a former member, when the member is gone', () => {
    expect(describeAudit(entry({ action: 'removed', targetUserId: 'u9' }), names)).toBe(
      'Dana Levi removed sam@example.com',
    );
    expect(describeAudit(entry({ action: 'removed', targetUserId: null, targetEmail: null }), names)).toBe(
      'Dana Levi removed a former member',
    );
  });

  it('reads adds, joins, invitations and expiry changes', () => {
    expect(describeAudit(entry({ action: 'member_added', detail: { role: 'viewer' } }), names)).toBe(
      'Dana Levi added Sam Cohen as Viewer',
    );
    expect(describeAudit(entry({ action: 'joined', actorName: 'Kim Park', detail: { role: 'editor' } }), names)).toBe(
      'Kim Park joined as Editor',
    );
    expect(describeAudit(entry({ action: 'invited', detail: { role: 'editor' } }), names)).toBe(
      'Dana Levi created an invitation link for an Editor',
    );
    expect(describeAudit(entry({ action: 'invitation_revoked' }), names)).toBe('Dana Levi revoked an invitation link');
    expect(
      describeAudit(entry({ action: 'expiry_changed', detail: { from: null, to: '2026-12-12T23:59:59.000Z' } }), names),
    ).toBe('Dana Levi changed the access of Sam Cohen from permanent to until 12 Dec 2026');
  });
});

describe('gateMenu', () => {
  const items = [
    { id: 'studio', label: 'Edit in Tale Studio' },
    { id: 'rename', label: 'Rename' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'status:archived', label: 'Archive' },
    { id: 'place', label: 'Show in another zone', disabledReason: 'Already in every zone' },
  ];
  const needed = (permission: string) => `needs ${permission}`;

  it('maps menu items to the permission they need', () => {
    expect(menuPermission('studio')).toBeNull();
    expect(menuPermission('rename')).toBe('content.edit');
    expect(menuPermission('schedule')).toBe('content.publish');
    expect(menuPermission('status:paused')).toBe('content.publish');
  });

  it('disables, with the reason, what the role cannot do, and keeps an existing reason', () => {
    const editor = gateMenu(items, (p) => p === 'content.edit' || p === 'project.view', needed);
    expect(editor.map((i) => i.disabledReason ?? '')).toEqual([
      '',
      '',
      'needs content.publish',
      'needs content.publish',
      'Already in every zone',
    ]);
    const viewer = gateMenu(items, () => false, needed);
    expect(viewer[0].disabledReason).toBeUndefined();
    expect(viewer[1].disabledReason).toBe('needs content.edit');
  });
});
