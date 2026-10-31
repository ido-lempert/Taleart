import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from '../app.routes';

function readUp(file: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    try {
      return readFileSync(join(dir, file), 'utf8');
    } catch {
      dir = join(dir, '..');
    }
  }
  throw new Error(`${file} not found above ${process.cwd()}`);
}

describe('Demo data page', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/demo-data');
    page = harness.routeNativeElement as HTMLElement;
  });

  it('documents every option of the seed-demo command and its exit code', () => {
    const source = readUp('apps/cli/src/commands/seed-demo.ts');
    const options = [...source.matchAll(/^\s+(?:'([a-z-]+)'|([a-z]+)): \{ type: 'boolean'/gm)].map((m) => m[1] ?? m[2]);
    expect(options.sort()).toEqual(['dry-run', 'force']);
    const text = page.textContent ?? '';
    for (const option of [...options, 'json', 'api-url']) expect(text).toContain(`--${option}`);
    expect(source).toContain('EXIT.conflict');
    expect(readUp('apps/cli/src/errors.ts')).toMatch(/conflict: 6/);
    expect(text).toContain('code 6');
    expect(text).toContain('seed_refused');
  });

  it('names the variables, the project and the numbers the seed makes', () => {
    const text = page.textContent ?? '';
    for (const word of ['TALEART_SEED_DEMO=true', 'TALEART_API_URL', 'TALEART_TOKEN', 'taleart login', 'Spring Campaign 2', 'example.com', 'Apache-2.0', 'docker compose down -v']) {
      expect(text).toContain(word);
    }
    expect(readUp('.env.docker.example')).toContain('TALEART_SEED_DEMO=true');
    const rows = [...page.querySelectorAll('#seed-demo-contents tbody tr')].map((row) => row.textContent ?? '');
    expect(rows.some((row) => /Zones\s*3/.test(row))).toBe(true);
    expect(rows.some((row) => /Tale groups\s*5/.test(row))).toBe(true);
    expect(rows.some((row) => /Tales\s*13/.test(row))).toBe(true);
  });
});
