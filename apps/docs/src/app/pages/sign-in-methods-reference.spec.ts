import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from '../app.routes';
import { SIGN_IN_ENDPOINTS, SIGN_IN_ERRORS, SECURITY_PROPERTIES } from './sign-in-methods-reference';

function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('nx.json not found above ' + process.cwd());
    dir = up;
  }
  return dir;
}

// The contract is read as text, the same way the docs read it elsewhere: the docs project cannot import the contract's build.
const CONTRACT = parse(readFileSync(join(workspaceRoot(), 'libs/contract/openapi/openapi.yaml'), 'utf8'));

/** The operations of the Sign-in methods tag, as `METHOD /path`. */
function signInMethodsOperations(): string[] {
  const ops: string[] = [];
  for (const [path, item] of Object.entries<Record<string, { tags?: string[] }>>(CONTRACT.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (op && typeof op === 'object' && op.tags?.includes('Sign-in methods')) ops.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return ops.sort();
}

describe('the Sign-in methods reference', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/reference/sign-in-methods');
    page = harness.routeNativeElement as HTMLElement;
  });

  const rows = (table: string) => [...page.querySelectorAll(`#${table} tbody tr`)];

  it('lists every operation of the contract\'s Sign-in methods tag in the endpoints table, and no other', () => {
    const listed = rows('endpoints').map((row) => {
      const cells = [...row.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? '');
      return `${cells[0]} ${cells[1]}`;
    });
    expect(listed.length).toBe(signInMethodsOperations().length);
    expect([...listed].sort()).toEqual(signInMethodsOperations());
  });

  it('keeps the endpoint constant in step with the table', () => {
    expect(SIGN_IN_ENDPOINTS.length).toBe(rows('endpoints').length);
  });

  it('names every error code of sign-in the contract names for the tag, and only codes the contract defines', () => {
    const enumCodes: string[] = CONTRACT.components.schemas.ErrorCode.enum;
    const tagText = signInMethodsOperations()
      .map((key) => {
        const [method, path] = key.split(' ');
        return CONTRACT.paths[path][method.toLowerCase()].description ?? '';
      })
      .join('\n');
    const named = enumCodes.filter((code) => tagText.includes(code));
    expect(named.length).toBeGreaterThan(0);
    const documented = rows('errors').map((row) => row.querySelector('th code, th')?.textContent?.trim() ?? '');
    for (const code of named) expect(documented, code).toContain(code);
    for (const code of documented) expect(enumCodes, code).toContain(code);
    expect(documented.length).toBe(SIGN_IN_ERRORS.length);
  });

  it('shows the methods table with the five method ids', () => {
    const ids = rows('methods').map((row) => row.querySelector('th code')?.textContent?.trim());
    expect(ids).toEqual(['passkey', 'password', 'google', 'apple', 'oidc:<slug>']);
  });

  it('shows the provider settings for every kind, with the redirect URI format', () => {
    const fields = rows('provider-fields').map((row) => row.querySelector('th')?.textContent?.trim() ?? '');
    expect(fields.length).toBeGreaterThanOrEqual(8);
    expect(fields.join(' | ')).toMatch(/Client secret/);
    expect(fields.join(' | ')).toMatch(/Team ID/);
    expect(page.textContent).toContain('PUBLIC_API_URL/api/v1/auth/callback/<slug>');
  });

  it('lists the environment variables of sign-in, with the secret key stored as encrypted', () => {
    const vars = rows('env').map((row) => row.querySelector('th code')?.textContent?.trim());
    expect(vars).toEqual(['TALEART_SECRET_KEY', 'TALEART_SETUP_PASSWORD', 'PUBLIC_API_URL', 'RP_ORIGIN', 'RP_ID', 'NODE_ENV']);
    expect(page.textContent).toContain('openssl rand -base64 32');
  });

  it('states the security properties, with the algorithms and limits', () => {
    const items = [...page.querySelectorAll('ul li')].map((li) => li.textContent ?? '');
    expect(items.length).toBe(SECURITY_PROPERTIES.length);
    const all = items.join('\n');
    for (const phrase of ['AES-256-GCM', 'scrypt', 'N=2^15', 'S256', 'RS256', 'none', 'email', 'invitation only', '24 hours']) {
      expect(all, phrase).toContain(phrase);
    }
  });
});
