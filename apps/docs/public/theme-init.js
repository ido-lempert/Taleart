// Applies the reader's saved colour theme before the first paint, so a dark page never flashes light.
// An external script rather than an inline one, so the docs keep working under a strict Content-Security-Policy.
// The storage key matches THEME_KEY in src/app/theme.ts. Without a saved choice nothing is set and the
// page follows prefers-color-scheme.
try {
  const saved = window.localStorage.getItem('taleart-docs-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch {
  // Storage blocked: the system theme applies.
}
