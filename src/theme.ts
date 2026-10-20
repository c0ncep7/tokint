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
async function restoreTheme() {
  try { applyTheme((await chrome.storage.local.get('theme')).theme); }
  catch { applyTheme('dark'); }
}
void restoreTheme();
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(document.documentElement.dataset.theme ?? 'dark');
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    void chrome.storage.local.set({ theme }).catch(() => {});
  });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) void restoreTheme();
});
