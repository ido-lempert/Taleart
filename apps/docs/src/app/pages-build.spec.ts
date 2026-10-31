import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The docs live at the root of https://taleart.lempert.site/ (GitHub Pages custom domain), so the Pages build
// must use the base href "/". A "/Taleart/" base (the old project path) breaks every asset, script and route.
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

describe('GitHub Pages build', () => {
  it('is configured with the root base href', () => {
    const project = JSON.parse(readFileSync(join(root, 'apps/docs/project.json'), 'utf8'));
    expect(project.targets.build.configurations['github-pages'].baseHref).toBe('/');
  });

  it('keeps the dark tokens in a render-blocking stylesheet (no critical-CSS inlining that drops them)', () => {
    const project = JSON.parse(readFileSync(join(root, 'apps/docs/project.json'), 'utf8'));
    for (const name of ['production', 'github-pages']) {
      expect(project.targets.build.configurations[name].optimization.styles.inlineCritical).toBe(false);
    }
  });

  const built = join(root, 'dist/apps/docs-pages/browser/index.html');
  it.skipIf(!existsSync(built))('has <base href="/"> in the built output when it was built', () => {
    expect(readFileSync(built, 'utf8')).toContain('<base href="/">');
  });
});
