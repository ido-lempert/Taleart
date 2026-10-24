import type { ChoiceResult } from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { InvalidResponseValueError, ResponseTargetNotFoundError, VisitorIdRequiredError } from './errors';
import { migrateInteractive } from './migration';
import { recordResponse, taleResponseCounts } from './responses';

const delivered = vi.hoisted(() => vi.fn());
const findZone = vi.hoisted(() => vi.fn());
vi.mock('@taleart/server-tales', () => ({ deliveredTaleElement: delivered }));
vi.mock('@taleart/server-zones', () => ({ findZone }));

const projectId = '00000000-0000-4000-8000-000000000001';
const zoneId = '00000000-0000-4000-8000-000000000002';
const groupId = '00000000-0000-4000-8000-000000000003';
const taleId = '00000000-0000-4000-8000-000000000004';
const elementId = '00000000-0000-4000-8000-000000000005';
const frameId = '00000000-0000-4000-8000-000000000006';
const visitorId = '0f0e0d0c-0b0a-4908-8706-050403020100';
const now = new Date('2026-10-23T12:00:00Z');

const poll = {
  projectId,
  zoneId,
  taleGroupId: groupId,
  taleId,
  element: {
    id: elementId,
    type: 'poll',
    props: { question: 'Tea or coffee?', theme: 'light', options: [{ id: 'tea', label: 'Tea' }, { id: 'coffee', label: 'Coffee' }] },
  },
};

// A fake database answering queries in order from `answers`.
function fakeDb(answers: unknown[]) {
  const query = vi.fn(async () => answers.shift() ?? { rows: [] });
  return { db: { query } as unknown as Db, query };
}

const input = { zoneId, taleId, elementId, value: 'tea', visitorId, clientAt: null };

beforeEach(() => {
  delivered.mockReset();
  findZone.mockReset();
  findZone.mockResolvedValue({ id: zoneId, frame: { id: frameId } });
});

describe('migration', () => {
  it('keeps one response per visitor, tale, element and kind, deleted with the tale', async () => {
    const { db, query } = fakeDb([]);
    await migrateInteractive(db);
    const sql = query.mock.calls.map((c) => (c as unknown[])[0] as string).join('\n');
    expect(sql).toMatch(/tale_id uuid NOT NULL REFERENCES tales\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/project_id uuid NOT NULL REFERENCES projects\(id\)/);
    expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS interactive_responses_visitor_key\s+ON interactive_responses \(tale_id, element_id, interaction, visitor_id\)/);
    for (const column of ['zone_id', 'frame_id', 'tale_group_id', 'element_type', 'value', 'visitor_id', 'client_at', 'created_at']) {
      expect(sql).toContain(column);
    }
  });
});

describe('recordResponse', () => {
  it('records a vote with the AD-10 keys and answers the counts', async () => {
    delivered.mockResolvedValue(poll);
    const { db, query } = fakeDb([{ rows: [{ value: 'tea' }] }, { rows: [{ value: 'tea', count: '2' }, { value: 'coffee', count: '1' }] }]);
    const clientAt = new Date('2026-10-23T11:59:59Z');
    const result = await recordResponse(db, { ...input, clientAt }, now);
    expect(result).toEqual({
      elementId,
      value: 'tea',
      recorded: true,
      result: {
        total: 3,
        choices: [
          { id: 'tea', count: 2, percent: 67 },
          { id: 'coffee', count: 1, percent: 33 },
        ],
      },
    });
    expect(delivered).toHaveBeenCalledWith(db, zoneId, taleId, elementId, now);
    const params = (query.mock.calls[0] as unknown[])[1];
    expect(params).toEqual([taleId, elementId, 'vote', visitorId, projectId, zoneId, frameId, groupId, 'poll', 'tea', clientAt, now]);
  });

  it('answers the first vote on a repeat (C9)', async () => {
    delivered.mockResolvedValue(poll);
    const { db } = fakeDb([{ rows: [] }, { rows: [{ value: 'coffee' }] }, { rows: [{ value: 'coffee', count: '1' }] }]);
    const result = await recordResponse(db, input, now);
    expect(result.recorded).toBe(false);
    expect(result.value).toBe('coffee');
    expect((result.result as ChoiceResult).choices.map((c) => c.percent)).toEqual([0, 100]);
  });

  it('records a rating as its whole number and answers the count and average (R5)', async () => {
    const rating = { ...poll, element: { id: elementId, type: 'rating', props: { question: 'How was it?', emoji: '❤️', theme: 'light' } } };
    delivered.mockResolvedValue(rating);
    const { db, query } = fakeDb([{ rows: [{ value: '80' }] }, { rows: [{ value: '80', count: '1' }, { value: '40', count: '1' }, { value: 'tea', count: '9' }] }]);
    const result = await recordResponse(db, { ...input, value: '80' }, now);
    expect(result).toEqual({ elementId, value: '80', recorded: true, result: { total: 2, average: 60 } });
    const params = (query.mock.calls[0] as unknown[])[1];
    expect(params).toEqual([taleId, elementId, 'rate', visitorId, projectId, zoneId, frameId, groupId, 'rating', '80', null, now]);
  });

  it('refuses a rating that is not a whole number from 0 to 100 written plainly', async () => {
    delivered.mockResolvedValue({ ...poll, element: { id: elementId, type: 'rating', props: { question: 'Q', emoji: '❤️', theme: 'dark' } } });
    const { db, query } = fakeDb([]);
    for (const value of ['101', '-1', '080', '8.5', ' 8', '', 'tea', 80, null]) {
      await expect(recordResponse(db, { ...input, value }, now)).rejects.toBeInstanceOf(InvalidResponseValueError);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("records a quiz answer as one of its answer ids and answers the counts per answer, whatever is correct (R3, C10)", async () => {
    const answers = [{ id: 'a', label: 'Mercury' }, { id: 'b', label: 'Venus' }, { id: 'c', label: 'Earth' }];
    const quiz = { ...poll, element: { id: elementId, type: 'quiz', props: { question: 'Hottest?', answers, correctAnswerId: 'b', theme: 'light' } } };
    delivered.mockResolvedValue(quiz);
    const { db, query } = fakeDb([{ rows: [{ value: 'c' }] }, { rows: [{ value: 'c', count: '1' }, { value: 'b', count: '3' }, { value: 'gone', count: '4' }] }]);
    const result = await recordResponse(db, { ...input, value: 'c' }, now);
    expect(result).toEqual({
      elementId,
      value: 'c',
      recorded: true,
      result: {
        total: 4,
        choices: [
          { id: 'a', count: 0, percent: 0 },
          { id: 'b', count: 3, percent: 75 },
          { id: 'c', count: 1, percent: 25 },
        ],
      },
    });
    const params = (query.mock.calls[0] as unknown[])[1];
    expect(params).toEqual([taleId, elementId, 'answer', visitorId, projectId, zoneId, frameId, groupId, 'quiz', 'c', null, now]);
  });

  it("refuses a quiz answer that is none of its answer ids, such as a poll's option or a rating", async () => {
    const quiz = { ...poll, element: { id: elementId, type: 'quiz', props: { question: 'Q', answers: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], theme: 'dark' } } };
    delivered.mockResolvedValue(quiz);
    const { db, query } = fakeDb([]);
    for (const value of ['tea', '80', 'A', 'a ', '', 1, null]) {
      const refused = recordResponse(db, { ...input, value }, now);
      await expect(refused).rejects.toBeInstanceOf(InvalidResponseValueError);
      await expect(refused).rejects.toThrow("An answer is one of the quiz's answer ids");
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('records a zone without a display with no frame id', async () => {
    delivered.mockResolvedValue(poll);
    findZone.mockResolvedValue({ id: zoneId, frame: null });
    const { db, query } = fakeDb([{ rows: [{ value: 'tea' }] }]);
    await recordResponse(db, input, now);
    expect(((query.mock.calls[0] as unknown[])[1] as unknown[])[6]).toBeNull();
  });

  it('refuses a tale not delivered in the zone and an element that is not interactive', async () => {
    const { db, query } = fakeDb([]);
    delivered.mockResolvedValue(null);
    await expect(recordResponse(db, input, now)).rejects.toBeInstanceOf(ResponseTargetNotFoundError);
    delivered.mockResolvedValue({ ...poll, element: { ...poll.element, type: 'button' } });
    await expect(recordResponse(db, input, now)).rejects.toBeInstanceOf(ResponseTargetNotFoundError);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a tale deleted between the check and the insert as not found, not a server error', async () => {
    delivered.mockResolvedValue(poll);
    const fk = Object.assign(new Error('insert or update violates foreign key constraint'), { code: '23503' });
    const { db } = fakeDb([fk]);
    const query = (db as unknown as { query: ReturnType<typeof vi.fn> }).query;
    query.mockImplementationOnce(async () => {
      throw fk;
    });
    await expect(recordResponse(db, input, now)).rejects.toBeInstanceOf(ResponseTargetNotFoundError);
    // Any other database error is passed on.
    const other = Object.assign(new Error('boom'), { code: '57014' });
    query.mockImplementationOnce(async () => {
      throw other;
    });
    await expect(recordResponse(db, input, now)).rejects.toBe(other);
  });

  it('refuses a value that is not one of the options', async () => {
    delivered.mockResolvedValue(poll);
    const { db, query } = fakeDb([]);
    for (const value of ['milk', '', 1, null, 'x'.repeat(65), 'TEA']) {
      await expect(recordResponse(db, { ...input, value }, now)).rejects.toBeInstanceOf(InvalidResponseValueError);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a missing or invalid visitor id before reading anything', async () => {
    const { db } = fakeDb([]);
    for (const id of ['', 'not-a-uuid', '0F0E0D0C-0B0A-4908-8706-050403020100', '0f0e0d0c-0b0a-1908-8706-050403020100']) {
      await expect(recordResponse(db, { ...input, visitorId: id }, now)).rejects.toBeInstanceOf(VisitorIdRequiredError);
    }
    expect(delivered).not.toHaveBeenCalled();
  });
});

describe('taleResponseCounts', () => {
  it('groups the counts per element, most first', async () => {
    const other = '00000000-0000-4000-8000-000000000007';
    const { db, query } = fakeDb([
      {
        rows: [
          { elementId, elementType: 'poll', value: 'tea', count: '3' },
          { elementId, elementType: 'poll', value: 'coffee', count: '1' },
          { elementId: other, elementType: 'poll', value: 'a', count: '2' },
        ],
      },
    ]);
    expect(await taleResponseCounts(db, taleId)).toEqual({
      elements: [
        { elementId, elementType: 'poll', total: 4, values: [{ value: 'tea', count: 3 }, { value: 'coffee', count: 1 }] },
        { elementId: other, elementType: 'poll', total: 2, values: [{ value: 'a', count: 2 }] },
      ],
    });
    expect((query.mock.calls[0] as unknown[])[1]).toEqual([taleId]);
  });

  it('never queries for an id that is not a UUID', async () => {
    const { db, query } = fakeDb([]);
    expect(await taleResponseCounts(db, 'nope')).toEqual({ elements: [] });
    expect(query).not.toHaveBeenCalled();
  });
});
