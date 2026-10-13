# nikhilpawar.dev

My personal site. One static page, no build step.

- `index.html`: the page, with its styles and script inline
- `bg.js`: the live 3D distributed system behind the opening line (three.js from a pinned CDN build; `?s=2` and `?s=3` show the other structure styles)
- `favicon.png`, `apple-touch-icon.png`: browser tab and home-screen icons ("NP" in Hanken Grotesk)
- `og-card.png`: the 1200 × 627 preview card shown when the link is shared (LinkedIn, Slack, iMessage, X)
- `_headers`: security headers for Cloudflare Pages

Deployed on Cloudflare Pages from the `main` branch. To preview locally, serve the folder (the 3D scene is an ES module, so `file://` won't load it): `python3 -m http.server 8000 --bind 127.0.0.1`.
