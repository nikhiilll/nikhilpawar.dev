# nikhilpawar.dev

My personal site. One static page, no build step.

- `index.html`: the page, with its styles and script inline. Light and dark themes follow the system until the toggle is used.
- `favicon.png`, `apple-touch-icon.png`: browser tab and home-screen icons ("NP" in Hanken Grotesk)
- `link-card.png`: the 1200 × 627 preview card shown when the link is shared (LinkedIn, Slack, iMessage, X). LinkedIn caches images by URL, so give a new card a new file name.
- `_headers`: security headers for Cloudflare Pages

**Reading list (hidden for now):** the `<script type="application/json" id="shelf">` block near the end of `index.html` holds a list of `{ "title", "url", "note" }` links. While it's empty the Reading section isn't shown; add a link and it appears.

Deployed on Cloudflare Pages from the `main` branch. To preview locally, serve the folder: `python3 -m http.server 8000 --bind 127.0.0.1`.
