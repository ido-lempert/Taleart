import { groupLabels, labelOutcome, labelText } from './labels';

describe('groupLabels', () => {
  it('reads a list, or a JSON string holding one, with each value at its place', () => {
    expect(groupLabels(['a', 7])).toEqual({
      values: [
        { position: 1, value: 'a' },
        { position: 2, value: 7 },
      ],
      wrongType: false,
    });
    expect(groupLabels('["a"]')).toEqual({ values: [{ position: 1, value: 'a' }], wrongType: false });
  });

  it('reads no labels from nothing, and flags any other value as of the wrong type', () => {
    for (const empty of [undefined, null, '', '  ', [], '[]', 'null']) {
      expect(groupLabels(empty)).toEqual({ values: [], wrongType: false });
    }
    for (const wrong of [{ include: ['a'] }, 7, true, '[not json', '"text"', '{"a":1}']) {
      expect(groupLabels(wrong)).toEqual({ values: [], wrongType: true });
    }
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
});
