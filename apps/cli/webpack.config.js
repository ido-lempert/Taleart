const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { chmodSync } = require('fs');
const { join } = require('path');
const { BannerPlugin } = require('webpack');

const outputPath = join(__dirname, '../../dist/apps/cli');

/** Makes the built CLI executable, so `./taleart.js` and a linked `taleart` bin run it. */
class Executable {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('Executable', () => chmodSync(join(outputPath, 'taleart.js'), 0o755));
  }
}

// One runnable file: the CLI and the contract code it uses, with no runtime dependency (Node's
// fetch, util.parseArgs and fs only), so `node dist/apps/cli/taleart.js` runs anywhere Node 22 does.
module.exports = {
  // The plugin adds the one entry, named after outputFileName (taleart).
  entry: {},
  // `import text from '…/SKILL.md?raw'`: the agent skill's files (skills/taleart) as strings, so
  // `taleart skill install` needs nothing beside this one file (src/skill-files.ts).
  module: {
    rules: [{ resourceQuery: /raw/, type: 'asset/source' }],
  },
  output: {
    path: outputPath,
    clean: true,
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      outputFileName: 'taleart.js',
      tsConfig: './tsconfig.app.json',
      assets: [{ input: '.', glob: 'package.json', output: '.' }],
      externalDependencies: 'none',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: false,
    }),
    new BannerPlugin({ banner: '#!/usr/bin/env node', raw: true, entryOnly: true }),
    new Executable(),
  ],
};
