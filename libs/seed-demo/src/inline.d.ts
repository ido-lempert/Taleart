// Picture imports (`import sofa from './assets/s01.jpg?inline'`): webpack's asset/inline rule in the
// CLI and API builds, Vite's ?inline in the tests. Both give a `data:image/jpeg;base64,…` URL.
declare module '*.jpg?inline' {
  const dataUrl: string;
  export default dataUrl;
}
