import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from '../app.routes';

function exampleVariables(): string[] {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    try {
      const text = readFileSync(join(dir, '.env.docker.example'), 'utf8');
      return [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    } catch {
      dir = join(dir, '..');
    }
  }
  throw new Error('.env.docker.example not found above ' + process.cwd());
}

describe('Install with Docker page', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/docker');
    page = harness.routeNativeElement as HTMLElement;
  });

  it('lists every variable of .env.docker.example in the table, once', () => {
    const documented = [...page.querySelectorAll('tr[data-env]')].map((row) => row.getAttribute('data-env'));
    const variables = exampleVariables();
    expect(variables.length).toBeGreaterThan(10);
    for (const name of variables) expect(documented, name).toContain(name);
    expect(new Set(documented).size).toBe(documented.length);
  });

  it('names the four services, the routed paths and the key commands', () => {
    const text = page.textContent ?? '';
    for (const word of ['db', 'api', 'dashboard', 'proxy', '/delivery/*', 'pg_dump', 'docker compose up -d --build', 'external-proxy']) {
      expect(text).toContain(word);
    }
  });
});
