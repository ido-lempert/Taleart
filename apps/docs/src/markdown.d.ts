// Markdown files imported as text (`with { loader: 'text' }`), such as the agent skill.
declare module '*.md' {
  const content: string;
  export default content;
}
