# wordsnap.ai

Static site for the extension: `index.html`, `privacy.html` (the Chrome Web Store listing links here), `terms.html`. No build step; all CSS is inline and nothing loads from the network.

Deploy: a Cloudflare Worker with static assets, project "wordsnap" under Workers & Pages, connected to this repo. `wrangler.jsonc` at the repo root points it at this directory; build command empty, deploy command `npx wrangler deploy`, root directory `/`. Every push to `main` redeploys. Custom domains `wordsnap.ai` and `www.wordsnap.ai` are attached on the project's Domains tab (DNS is already on Cloudflare). `_headers` sets the security headers.

Images: `screenshot-open.png` and `og.png` come from `cd extension && npm run build:dev && node test/e2e/serve.mjs & node scripts/store-screenshots.mjs` (copy `store/screenshots/03-panel.png` and `store/og-1200x630.png` here).

Still to add: the store id in the Add to Chrome link in `index.html` (after the first store upload), and confirm the `privacy@wordsnap.ai` mailbox named in `privacy.html`.
