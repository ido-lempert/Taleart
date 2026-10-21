import { humanize, initialSettings, settingsFields } from './settings-form';

describe('settings form schema reading', () => {
  const schema = {
    type: 'object',
    properties: {
      shape: { type: 'string', enum: ['circle', 'rounded-square'], default: 'circle' },
      showTitles: { type: 'boolean', default: true },
      gap: { title: 'Gap', description: 'In px.', type: 'integer', minimum: 4, maximum: 24, default: 12 },
      ratio: { type: 'number' },
      colors: { type: 'array', items: { type: 'string' }, default: ['#fff'] },
    },
  };

  it('humanizes keys and values for labels', () => {
    expect(humanize('rounded-square')).toBe('Rounded square');
    expect(humanize('showTitles')).toBe('Show titles');
    expect(humanize('center')).toBe('Center');
  });

  it('turns enums into choices, booleans into toggles and numbers into ranged inputs, skipping the rest', () => {
    expect(settingsFields(schema)).toEqual([
      {
        key: 'shape',
        label: 'Shape',
        hint: '',
        default: 'circle',
        kind: 'choice',
        choices: [
          { value: 'circle', label: 'Circle' },
          { value: 'rounded-square', label: 'Rounded square' },
        ],
      },
      { key: 'showTitles', label: 'Show titles', hint: '', default: true, kind: 'toggle' },
      { key: 'gap', label: 'Gap', hint: 'In px.', default: 12, kind: 'number', min: 4, max: 24, step: 1 },
      { key: 'ratio', label: 'Ratio', hint: '', default: undefined, kind: 'number', min: undefined, max: undefined, step: 0.1 },
    ]);
  });

  it('reads a schema without properties as no fields', () => {
    expect(settingsFields({ type: 'object' })).toEqual([]);
    expect(settingsFields(undefined)).toEqual([]);
  });

  it('fills unset editable fields with defaults and keeps stored values, other fields included', () => {
    expect(initialSettings(schema, { gap: 20, colors: ['#000'] })).toEqual({
      shape: 'circle',
      showTitles: true,
      gap: 20,
      colors: ['#000'],
    });
    expect(initialSettings(schema, null)).toEqual({ shape: 'circle', showTitles: true, gap: 12 });
  });
});
