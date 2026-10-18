// Runs before the stylesheet so a saved light preference does not flash dark.
const themeKey = 'tokint-theme';
type Theme = 'dark' | 'light';
function applyTheme(value: string | null) {
  const theme: Theme = value === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  const button = document.getElementById('theme-toggle');
  if (button) {
    const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('aria-pressed', String(theme === 'light'));
  }
}
try {
  let saved = localStorage.getItem(themeKey);
  // Preserve a theme from an earlier app prefix without keeping obsolete keys.
  for (const key of Object.keys(localStorage)) {
    if (key === themeKey || !key.endsWith('-theme')) continue;
    const value = localStorage.getItem(key);
    if (value !== 'light' && value !== 'dark') continue;
    if (saved === null) { saved = value; localStorage.setItem(themeKey, saved); }
    localStorage.removeItem(key);
  }
  applyTheme(saved);
} catch { applyTheme('dark'); }
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(document.documentElement.dataset.theme ?? 'dark');
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    try { localStorage.setItem(themeKey, theme); } catch { /* Keep this page usable when storage is unavailable. */ }
  });
});
window.addEventListener('storage', event => { if (event.key === themeKey || event.key === null) applyTheme(event.newValue); });
