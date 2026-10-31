import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from '../app.routes';
import { API_REFERENCE_LOADER, type ApiReferenceLoader, labelSwaggerControls } from './api-reference';
import {
  API_URL_STORAGE_KEY,
  DEFAULT_API_URL,
  normalizeApiUrl,
  type OpenApiDocument,
  operationList,
  prepareSpec,
  readApiUrl,
  SESSION_ONLY_NOTE,
  storeApiUrl,
  SWAGGER_UI,
} from './api-reference-spec';

function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('nx.json not found above ' + process.cwd());
    dir = up;
  }
  return dir;
}

const root = workspaceRoot();
const read = (path: string) => readFileSync(join(root, path));
const generated = JSON.parse(read('libs/contract/src/generated/openapi.json').toString('utf8')) as OpenApiDocument;

/** Every operation of openapi.yaml as `METHOD /path`, read from the YAML text, not the JSON. */
function yamlOperations(): string[] {
  const yaml = read('libs/contract/openapi/openapi.yaml').toString('utf8');
  const paths = yaml.slice(yaml.indexOf('\npaths:\n'), yaml.indexOf('\ncomponents:\n'));
  const found: string[] = [];
  let path = '';
  for (const line of paths.split('\n')) {
    const key = /^ {2}(\/\S*):$/.exec(line);
    if (key) path = key[1];
    const method = /^ {4}(get|put|post|delete|options|head|patch|trace):$/.exec(line);
    if (method) found.push(`${method[1].toUpperCase()} ${path}`);
  }
  return found;
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, String(v)),
  };
}

describe('the API reference spec (epic developer experience 10.2)', () => {
  const api = 'https://api.example.com';
  const shown = prepareSpec(generated, api);

  it('shows every path and method of openapi.yaml', () => {
    const expected = yamlOperations();
    expect(expected.length).toBeGreaterThan(80);
    expect(operationList(shown).sort()).toEqual([...expected].sort());
  });

  it('sends Try it out to the API URL: every server absolute', () => {
    expect(shown.servers).toEqual([{ url: `${api}/api/v1` }]);
    expect(shown.paths['/zone'].servers?.[0].url).toBe(`${api}/delivery/v1`);
    expect(shown.paths['/responses'].servers?.[0].url).toBe(`${api}/delivery/v1`);
    expect(shown.paths['/media/{key}'].servers?.[0].url).toBe(api);
    expect(shown.paths['/openapi.json'].servers?.[0].url).toBe(`${api}/api`);
    const relative = JSON.stringify(shown).match(/"url":"\/[^"]*"/g);
    expect(relative).toBeNull();
  });

  it('offers the token, site key and zone key schemes, never the cookie session', () => {
    expect(Object.keys(shown.components?.securitySchemes ?? {}).sort()).toEqual(['siteKey', 'token', 'zoneKey']);
    expect(shown.security).toEqual([{ token: [] }]);
    expect(JSON.stringify(shown)).not.toContain('"session":[]');
    const zone = shown.paths['/zone']['get'] as { security: unknown };
    expect(zone.security).toEqual([{ siteKey: [] }, { zoneKey: [] }]);
  });

  it('marks the operations only a dashboard session may call', () => {
    const marked = operationList(shown).filter((op) => {
      const [method, path] = op.split(' ');
      const operation = shown.paths[path][method.toLowerCase()] as { description?: string };
      return operation.description?.startsWith(SESSION_ONLY_NOTE);
    });
    expect(marked.sort()).toEqual(
      [
        'GET /api-tokens',
        'POST /api-tokens',
        'DELETE /api-tokens/{tokenId}',
        'DELETE /users/{userId}/api-tokens',
        'POST /projects/{projectId}/invitations',
        'DELETE /projects/{projectId}/invitations/{invitationId}',
        'POST /projects/{projectId}/members',
        'PATCH /projects/{projectId}/members/{userId}',
        'DELETE /projects/{projectId}/members/{userId}',
        'GET /users',
        'GET /auth/settings',
        'PUT /auth/settings',
        'GET /auth/providers',
        'PUT /auth/providers/{slug}',
        'DELETE /auth/providers/{slug}',
        'POST /auth/providers/{slug}/test',
        'POST /auth/users/{userId}/password-reset',
        'GET /auth/account/methods',
        'PUT /auth/account/password',
        'DELETE /auth/account/password',
        'DELETE /auth/account/passkeys/{passkeyId}',
        'DELETE /auth/account/identities/{identityId}',
      ].sort(),
    );
  });

  it('keeps the tags in the document order and leaves the input unchanged', () => {
    expect(shown.tags?.map((t) => t.name)).toEqual(generated.tags?.map((t) => t.name));
    expect(shown.tags?.[0].name).toBe('Reference');
    expect(generated.servers).toEqual([{ url: '/api/v1' }]);
    expect(generated.components?.securitySchemes).toHaveProperty('session');
  });

  it('accepts only http and https URLs, without a trailing slash', () => {
    expect(normalizeApiUrl(' https://api.example.com/ ')).toBe('https://api.example.com');
    expect(normalizeApiUrl('http://localhost:3333')).toBe('http://localhost:3333');
    expect(normalizeApiUrl('https://example.com/taleart/')).toBe('https://example.com/taleart');
    for (const bad of ['', 'localhost:3333', 'javascript:alert(1)', 'ftp://x', 'https://u:p@x.com', 'https://x.com/?a=1', 'https://x.com/#a']) {
      expect(normalizeApiUrl(bad)).toBeNull();
    }
  });

  it('keeps the API URL in storage, and survives storage that throws', () => {
    const storage = memoryStorage();
    expect(readApiUrl(() => storage)).toBe(DEFAULT_API_URL);
    storeApiUrl(() => storage, 'https://api.example.com');
    expect(storage.getItem(API_URL_STORAGE_KEY)).toBe('https://api.example.com');
    expect(readApiUrl(() => storage)).toBe('https://api.example.com');
    storage.setItem(API_URL_STORAGE_KEY, 'javascript:alert(1)');
    expect(readApiUrl(() => storage)).toBe(DEFAULT_API_URL);
    storeApiUrl(() => storage, DEFAULT_API_URL);
    expect(storage.getItem(API_URL_STORAGE_KEY)).toBeNull();
    const broken = () => {
      throw new Error('blocked');
    };
    expect(readApiUrl(broken)).toBe(DEFAULT_API_URL);
    expect(() => storeApiUrl(broken, 'https://x.com')).not.toThrow();
  });

  it('loads the vendored Swagger UI files with their integrity', () => {
    const sri = (path: string) => 'sha384-' + createHash('sha384').update(read(`apps/docs/public/${path}`)).digest('base64');
    expect(sri(SWAGGER_UI.script)).toBe(SWAGGER_UI.scriptIntegrity);
    expect(sri(SWAGGER_UI.style)).toBe(SWAGGER_UI.styleIntegrity);
    const readme = read('apps/docs/public/swagger-ui/README.md').toString('utf8');
    expect(readme).toContain(`swagger-ui-dist ${SWAGGER_UI.version}`);
    for (const file of ['LICENSE', 'NOTICE', 'swagger-ui-bundle.js.LICENSE.txt']) {
      expect(existsSync(join(root, 'apps/docs/public/swagger-ui', file))).toBe(true);
    }
  });

  it('copies the generated document into the docs build', () => {
    const project = JSON.parse(read('apps/docs/project.json').toString('utf8'));
    expect(project.targets.build.options.assets).toContainEqual({
      glob: 'openapi.json',
      input: 'libs/contract/src/generated',
      output: 'api-reference',
    });
    expect(project.targets.build.dependsOn).toContainEqual({ projects: ['contract'], target: 'generate' });
  });

  it('names the Authorize dialog and its close button', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<div class="modal-ux"><div class="modal-ux-header"><h3>Available authorizations</h3><button class="close-modal"></button></div><div class="auth-container"><input type="text" /></div></div>';
    labelSwaggerControls(host);
    expect(host.querySelector('.close-modal')?.getAttribute('aria-label')).toBe('Close');
    expect(host.querySelector('.auth-container input')?.getAttribute('type')).toBe('password');
    const dialog = host.querySelector('.modal-ux');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(host.querySelector(`#${dialog?.getAttribute('aria-labelledby')}`)?.textContent).toBe('Available authorizations');
  });
});

describe('the API reference page', () => {
  let started: { spec: OpenApiDocument }[];
  let updated: string[];
  let loggedOut: string[][];

  beforeEach(async () => {
    started = [];
    updated = [];
    loggedOut = [];
    localStorage.removeItem(API_URL_STORAGE_KEY);
    const loader: ApiReferenceLoader = {
      document: async () => generated,
      swaggerUi: async () => (_host, spec) => {
        started.push({ spec });
        return {
          specActions: { updateSpec: (s) => void updated.push(s) },
          authActions: { logout: (names) => void loggedOut.push(names) },
        };
      },
      leave: () => undefined,
    };
    await TestBed.configureTestingModule({
      providers: [provideRouter(appRoutes), { provide: API_REFERENCE_LOADER, useValue: loader }],
    }).compileComponents();
  });

  async function open() {
    const harness = await RouterTestingHarness.create('/api-reference');
    await new Promise((done) => setTimeout(done));
    harness.detectChanges();
    return harness;
  }

  it('introduces the reference and links to API tokens', async () => {
    const page = (await open()).routeNativeElement as HTMLElement;
    expect(page.querySelector('h1')?.textContent).toBe('API reference');
    expect(page.querySelector('a[href="/api-tokens"]')).not.toBeNull();
    expect(page.querySelector('label[for="api-url"]')?.textContent).toBe('API URL');
    expect((page.querySelector('#api-url') as HTMLInputElement).value).toBe(DEFAULT_API_URL);
    expect(page.textContent).toContain('Dashboard only');
    expect(page.querySelector('#accessibility')).not.toBeNull();
  });

  it('starts Swagger UI with the spec for the default API', async () => {
    await open();
    expect(started.length).toBe(1);
    expect(started[0].spec.servers).toEqual([{ url: `${DEFAULT_API_URL}/api/v1` }]);
  });

  it('switches to a new API URL, keeps it, and refuses one that is not http(s)', async () => {
    const harness = await open();
    const page = harness.routeNativeElement as HTMLElement;
    const field = page.querySelector('#api-url') as HTMLInputElement;
    const form = page.querySelector('form.api-url') as HTMLFormElement;

    field.value = 'ftp://nope';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    harness.detectChanges();
    expect(page.querySelector('#api-url-error')?.textContent).toContain('http or https');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain('api-url-error');
    expect(updated).toEqual([]);
    expect(loggedOut).toEqual([]);

    field.value = 'https://api.example.com/';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    harness.detectChanges();
    expect(page.querySelector('#api-url-error')).toBeNull();
    expect(localStorage.getItem(API_URL_STORAGE_KEY)).toBe('https://api.example.com');
    expect(JSON.parse(updated[0]).servers).toEqual([{ url: 'https://api.example.com/api/v1' }]);
    expect(page.querySelector('[role="status"]')?.textContent).toContain('https://api.example.com');
    expect(loggedOut).toEqual([['token', 'siteKey', 'zoneKey']]);
    expect(page.querySelector('[role="status"]')?.textContent).toContain(
      'Credentials cleared; authorize again for https://api.example.com',
    );
  });

  it('reads the stored API URL', async () => {
    localStorage.setItem(API_URL_STORAGE_KEY, 'https://stored.example.com');
    const page = (await open()).routeNativeElement as HTMLElement;
    expect((page.querySelector('#api-url') as HTMLInputElement).value).toBe('https://stored.example.com');
    expect(started[0].spec.servers).toEqual([{ url: 'https://stored.example.com/api/v1' }]);
  });
});
