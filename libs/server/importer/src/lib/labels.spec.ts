import { groupLabels, labelOutcome, labelText, MAX_GROUP_LABELS, MAX_SEGMENTS_JSON_BYTES, printable } from './labels';
import { storedText } from './record-shape';

describe('groupLabels', () => {
  it('reads a list, or a JSON string holding one, with each value at its place', () => {
    expect(groupLabels(['a', 7])).toEqual({
      values: [
        { position: 1, value: 'a' },
        { position: 2, value: 7 },
      ],
      beyond: 0,
      wrongType: false,
    });
    expect(groupLabels('["a"]')).toEqual({ values: [{ position: 1, value: 'a' }], beyond: 0, wrongType: false });
  });

  it('reads no labels from nothing, and flags any other value as of the wrong type', () => {
    for (const empty of [undefined, null, '', '  ', [], '[]', 'null']) {
      expect(groupLabels(empty)).toEqual({ values: [], beyond: 0, wrongType: false });
    }
    for (const wrong of [{ include: ['a'] }, 7, true, '[not json', '"text"', '{"a":1}']) {
      expect(groupLabels(wrong)).toEqual({ values: [], beyond: 0, wrongType: true });
    }
  });

  it(`reads at most ${MAX_GROUP_LABELS} values and counts the rest`, () => {
    const labels = groupLabels(Array.from({ length: MAX_GROUP_LABELS + 7 }, (_, i) => `l${i}`));
    expect(labels.values).toHaveLength(MAX_GROUP_LABELS);
    expect(labels.values[MAX_GROUP_LABELS - 1]).toEqual({
      position: MAX_GROUP_LABELS,
      value: `l${MAX_GROUP_LABELS - 1}`,
    });
    expect(labels.beyond).toBe(7);
  });

  it(`parses no JSON string over ${MAX_SEGMENTS_JSON_BYTES} bytes`, () => {
    const parse = vi.spyOn(JSON, 'parse');
    const big = JSON.stringify(['x'.repeat(MAX_SEGMENTS_JSON_BYTES)]);
    expect(groupLabels(big)).toEqual({ values: [], beyond: 0, wrongType: true });
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });
});

describe('labelText', () => {
  it('takes a string, or the first string an object names it under', () => {
    expect(labelText('vip')).toBe('vip');
    expect(labelText({ name: 'a', title: 'b' })).toBe('a');
    expect(labelText({ id: 1, label: 'c' })).toBe('c');
    expect(labelText({ value: 'd' })).toBe('d');
    for (const none of [7, null, undefined, ['a'], { name: 7 }, {}]) expect(labelText(none)).toBeNull();
  });
});

describe('labelOutcome', () => {
  it('names a tag with the trimmed text of 1 to 40 characters, else says why not', () => {
    expect(labelOutcome('  vip ')).toEqual({ name: 'vip' });
    expect(labelOutcome('x'.repeat(40))).toEqual({ name: 'x'.repeat(40) });
    expect(labelOutcome('x'.repeat(41))).toEqual({ reason: 'tooLong' });
    expect(labelOutcome('   ')).toEqual({ reason: 'blank' });
    expect(labelOutcome(null)).toEqual({ reason: 'notText' });
  });

  it('refuses control characters, NUL included, even in a long label', () => {
    expect(labelOutcome('a\u0000b')).toEqual({ reason: 'invalidCharacters' });
    expect(labelOutcome('\u0000')).toEqual({ reason: 'invalidCharacters' });
    expect(labelOutcome(`a\u007f${'x'.repeat(50)}`)).toEqual({ reason: 'invalidCharacters' });
    expect(labelOutcome('ends with a newline\n')).toEqual({ name: 'ends with a newline' });
  });

  it('stores report text with control characters shown as U+FFFD, since jsonb refuses NUL', () => {
    expect(printable('a\u0000b\u007fc\td')).toBe('a�b�c�d');
    expect(storedText('nul\u0000 secret', 'secret')).toBe('nul� [token]');
  });
});
