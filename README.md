# nikhilpawar.dev

My personal site. One static page, no build step: edit the files and push.

- `index.html`: the page's text. Work, Education and the opening are plain HTML; edit them there.
- `site.css`: the styles, with both light and dark colours at the top.
- `site.js`: the light/dark toggle and the reading shelf. It loads in `<head>` so the right theme is set before the first paint. Light and dark follow the system until the toggle is used.
- `fonts/`: Geist (Latin), served from this site rather than Google Fonts, with its licence (`OFL.txt`).
- `favicon.png`, `apple-touch-icon.png`: browser tab and home-screen icons (black "NP" in Geist on the page background).
- `share-card.png`: the 1200 × 627 preview card shown when the link is shared (LinkedIn, Slack, iMessage, X). LinkedIn caches images by URL, so give a new card a new file name.
- `robots.txt`, `sitemap.xml`: for search engines. Bump `<lastmod>` in the sitemap and `dateModified` in `index.html` when the content changes.
- `_headers`: security headers for Cloudflare Pages, including a Content Security Policy that only allows files from this site. Keep scripts and styles in `site.js` and `site.css`: inline `<script>` code or `style="…"` attributes will be blocked. (The JSON blocks in `index.html` are data, not code, so they're fine.)

**Search:** the `application/ld+json` block in `index.html`'s head tells search engines who the page is about (name, role, employer, schools, LinkedIn). Keep it in step with the page when the job changes.

**Reading list (hidden for now):** the `<script type="application/json" id="shelf">` block at the end of `index.html` holds a list of `{ "title", "url", "note" }` links. While it's empty the Reading section isn't shown; add a link and it appears.

Deployed on Cloudflare Pages from the `main` branch. To preview locally, serve the folder: `python3 -m http.server 8000 --bind 127.0.0.1` (this skips `_headers`, so the security policy isn't applied locally).
