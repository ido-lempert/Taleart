import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Zone keys and the `stage` attribute are gone (UX rework story 8.7): an element is placed only with
// the project's site key and a zone slug. No source file of the SDK (specs aside) may still name them.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.spec(-d)?\.ts$/.test(name) ? [path] : [];
  });
}

describe('the Web SDK source', () => {
  const files = sources(join(__dirname, '..'));

  it('is found', () => {
    expect(files.some((file) => file.endsWith('taleart-element.ts'))).toBe(true);
  });

  it.each(['zone-key', 'zoneKey', 'tak_', 'ZONE_KEY'])('never mentions %s', (word) => {
    const found = files.filter((file) => readFileSync(file, 'utf8').includes(word));
    expect(found).toEqual([]);
  });
});
