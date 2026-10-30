const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');
const { Compilation, WebpackError } = require('webpack');

/**
 * Fails the build when an asset it must carry was not emitted, such as the Web SDK bundle when
 * dist/libs/web-sdk was not built first (`--excludeTaskDependencies`): the asset copy skips a
 * missing input without an error, and Nx would otherwise cache an API that answers 404 for
 * /sdk/v1/taleart.js (story 8.19 review).
 */
class RequireAssets {
  constructor(files) {
    this.files = files;
  }
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('RequireAssets', (compilation) => {
      compilation.hooks.processAssets.tap({ name: 'RequireAssets', stage: Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
        for (const file of this.files) {
          if (!compilation.getAsset(file)) {
            compilation.errors.push(
              new WebpackError(`${file} was not emitted: build the Web SDK first (nx run web-sdk:build), then the API.`),
            );
          }
        }
      });
    });
  }
}

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: [
        './src/assets',
        // The frame-type registry is configuration read at start (AD-5).
        { input: '../../libs/contract/frame-types', glob: '*.json', output: 'frame-types' },
        // The test page (epic UX rework R13), and the Web SDK bundle it and host pages load
        // (web-sdk is an implicit dependency, so its build runs first).
        { input: './src/sdk-pages', glob: 'test-page.{html,js,css}', output: 'sdk-pages' },
        // The entry and its chunks (the viewer, split off by the build): the entry imports them by name.
        { input: '../../dist/libs/web-sdk', glob: '*.js', output: 'web-sdk' },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
    new RequireAssets(['web-sdk/index.js']),
  ],
};
