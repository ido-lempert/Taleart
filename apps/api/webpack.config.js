const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

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
        { input: '../../dist/libs/web-sdk', glob: 'index.js', output: 'web-sdk' },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};
