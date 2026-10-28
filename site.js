// Loaded in <head> without defer, so the theme is set before the first paint.
const root = document.documentElement;

/* ---------- Theme: the visitor's saved choice, otherwise the system setting ---------- */
function savedTheme() {
  try { return localStorage.getItem('theme'); } catch { return null; }
}
const systemDark = matchMedia('(prefers-color-scheme: dark)');
if (savedTheme() ? savedTheme() === 'dark' : systemDark.matches) root.dataset.theme = 'dark';

document.addEventListener('DOMContentLoaded', () => {
  const themeBtn = document.getElementById('theme-toggle');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  function setTheme(theme, save) {
    const dark = theme === 'dark';
    if (dark) root.dataset.theme = 'dark'; else delete root.dataset.theme;
    themeBtn.setAttribute('aria-pressed', String(dark));
    themeBtn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    themeColor.content = dark ? '#161513' : '#f5f2eb';
    if (save) try { localStorage.setItem('theme', theme); } catch {}
  }
  setTheme(root.dataset.theme === 'dark' ? 'dark' : 'light', false);
  // Until the visitor picks a theme, follow the system as it changes.
  systemDark.addEventListener('change', e => {
    if (!savedTheme()) setTheme(e.matches ? 'dark' : 'light', false);
  });
  themeBtn.addEventListener('click', e => {
    if (e.detail > 0) themeBtn.blur();
    // The page switches at once; only the icon turns. Fading the whole page made the icon flicker.
    setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });

  /* ---------- Reading shelf: hidden while the list in index.html is empty ---------- */
  let shelf = [];
  try { shelf = JSON.parse(document.getElementById('shelf').textContent); } catch {}
  if (shelf.length) {
    const sec = document.getElementById('reading'), ul = sec.querySelector('ul');
    for (const { title, url, note } of shelf) {
      const li = document.createElement('li'); li.className = 'row';
      const site = document.createElement('span'); site.className = 'yr';
      try { site.textContent = new URL(url).hostname.replace(/^www\./, ''); } catch {}
      const div = document.createElement('div'), a = document.createElement('a');
      a.href = url; a.textContent = title; a.target = '_blank'; a.rel = 'noopener'; div.append(a);
      if (note) { const p = document.createElement('p'); p.className = 'line'; p.textContent = note; div.append(p); }
      li.append(site, div); ul.append(li);
    }
    sec.hidden = false;
  }
});
