// Text imports (`import text from './file.md?raw'`): webpack's asset/source rule in the build
// (webpack.config.js), Vite's ?raw in the tests.
declare module '*?raw' {
  const content: string;
  export default content;
}
