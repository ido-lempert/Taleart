// Markdown files imported as text (`with { loader: 'text' }`), such as the docs' reference text.
declare module '*.md' {
  const content: string;
  export default content;
}
