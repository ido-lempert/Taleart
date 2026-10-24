// Fails when the Web SDK's published declarations do not stand on their own: a `.d.ts` in the dist folder
// names a workspace package (`@taleart/...`, not a dependency of the published package) or an OpenAPI schema
// (`components[...]`), or a consumer that imports the package from the dist folder does not type-check.
// Run through `nx run web-sdk:types-check`, which builds first.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const dist = resolve(root, process.argv[2] ?? 'dist/libs/web-sdk');
const FORBIDDEN = [/@taleart\//, /\bcomponents\s*\[/];

const declarations = readdirSync(dist, { recursive: true })
  .map(String)
  .filter((file) => file.endsWith('.d.ts'))
  .map((file) => join(dist, file));
if (!declarations.some((file) => relative(dist, file) === 'index.d.ts')) {
  console.error(`No index.d.ts in ${dist}.`);
  process.exit(1);
}

const leaks = declarations.flatMap((file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, i) =>
      FORBIDDEN.some((re) => re.test(line)) ? [`${relative(root, file)}:${i + 1}: ${line.trim()}`] : [],
    ),
);
if (leaks.length) {
  console.error('Published Web SDK declarations name internal packages or OpenAPI schemas:');
  for (const leak of leaks) console.error(`  ${leak}`);
  process.exit(1);
}

// A host page's TypeScript, outside the workspace (no path aliases), against the dist folder only.
const consumer = `import {
  configureZone,
  defineTaleartElement,
  setExternalUserId,
  setTags,
  TaleartElement,
  TALEART_ELEMENT_TAG,
  type ZoneOptions,
} from ${JSON.stringify(join(dist, 'index.js'))};

const options: ZoneOptions = { theme: { ringStyle: 'solid', ringColors: ['#000000'], cornerRadius: null } };
configureZone('promo', options);
configureZone('promo', null);
configureZone('home-top', { theme: { accentColor: '#000000' } });
defineTaleartElement(TALEART_ELEMENT_TAG);
// The viewer's tags (epic targeting R2); null clears them.
setTags(['summer', 'vip']);
setTags(null);
// @ts-expect-error tags are an array of names
setTags('summer');
// The viewer's external user ID (epic targeting R4); null sends none.
setExternalUserId('cust-1001');
setExternalUserId(null);
// @ts-expect-error the ID is text
setExternalUserId(1001);
const element = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
element.siteKey = 'tas_…';
element.zone = 'home-top';
const slug: string = element.zone;
const siteKey: string = element.siteKey;
export { slug, siteKey };
// Zone keys are gone (story 8.7): an element is placed only with a site key and a slug.
// @ts-expect-error no such property
element.zoneKey = 'old';
element.theme = { accentColor: '#ffffff' };
const ringWidth: number | undefined = element.theme.ringWidth;
export { ringWidth };
`;
const tsconfig = {
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: 'es2022',
    module: 'esnext',
    moduleResolution: 'bundler',
    lib: ['es2022', 'dom'],
    types: [],
    skipLibCheck: false,
  },
  files: ['consumer.ts'],
};

const dir = mkdtempSync(join(tmpdir(), 'taleart-web-sdk-types-'));
try {
  writeFileSync(join(dir, 'consumer.ts'), consumer);
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  const tsc = createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '-p', dir], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error('A consumer of the published Web SDK types does not type-check:');
    console.error(result.stdout || result.stderr || result.error);
    process.exit(1);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(
  `Web SDK declarations (${declarations.length} files) stand on their own and type-check from ${relative(root, dist)}.`,
);
