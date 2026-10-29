import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaleartElement } from './taleart-element';

// The README's attribute table (epic UX rework R17) lists exactly what the element observes, each
// with a property of the same meaning.
describe('the Web SDK README', () => {
  const readme = readFileSync(join(__dirname, '../../README.md'), 'utf8');
  const table = readme.slice(readme.indexOf('| Attribute / property | Meaning |'));
  const rows = [...table.slice(0, table.indexOf('\n\n')).matchAll(/^\| `([a-z-]+)` \/ `([A-Za-z]+)` \|/gm)].map(
    (m) => ({ attribute: m[1], property: m[2] }),
  );

  it('lists every observed attribute, and nothing else', () => {
    expect(rows.map((row) => row.attribute).sort()).toEqual([...TaleartElement.observedAttributes].sort());
  });

  it('names a property the element has for each attribute', () => {
    for (const { property } of rows) expect(property in TaleartElement.prototype).toBe(true);
  });

  it('documents the zone key, and no site key attribute the element ignores', () => {
    expect(readme).toContain('| `zone-key` / `zoneKey` |');
    expect(readme).not.toMatch(/\bsite-key=/);
  });
});
