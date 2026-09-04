# WordSnap 0.1 release plan

Goal: WordSnap installable from the Chrome Web Store, source public on GitHub under Apache-2.0, wordsnap.ai as the landing page with the privacy policy the store listing points at.

Sequence: week 1 decisions plus package and repo prep; week 2 site, listing assets, submit **unlisted**; week 3 dogfood the store build, flip to public, tag v0.1.0.

State on 2026-09-04: branch `worktree-release-prep` off `d185e69`, `npm run check` green (140 tests). Decisions 1 to 5 answered by the founder (see below). Done items are marked ✓.

## 0. Decisions (answered 2026-09-04)

1. ✓ Replace it. **wordsnap.ai serves a different product.** The live site (Render, gunicorn, redirects to app.wordsnap.ai) sells "rough thought to polished message, three perfect variations". That is the ghostwriter positioning the extension explicitly rejects. Recommendation: replace the landing page with the extension; keep the old app reachable at app.wordsnap.ai only if it still has users. Also: where does the site's source live today?
2. ✓ Keep all three hosts; the founder uses it on X daily. **Ship Gmail only in 0.1.** Drop `x.com`, `twitter.com`, `linkedin.com` from `host_permissions` and `content_scripts` until those adapters have run on the live sites. Fewer install warnings, less review scrutiny, no support load for untested hosts. Re-add in 0.2. Recommendation: yes.
3. ✓ Apache-2.0, copyright under the founder's own name (NOTICE still carries the GitHub handle; replace with the full name). **License.** Apache-2.0 (spec recommendation, patent grant). Copyright line: personal name or an entity.
4. ✓ Keep "WordSnap". **Name.** The store already lists "词随记-WordSnap", an English vocabulary trainer. Different category, no trademark found in a quick search, but store search will show both. Options: keep "WordSnap" as the item name (you own the domain), or use a longer store name such as "WordSnap: sharpen your argument before you send". A USPTO search is a 10 minute check before the repo goes public.
5. ✓ Personal account. **Publisher identity.** Personal Google account or an org account. The publisher name and a contact email are public on the listing, and the EU trader / non-trader declaration is required at account setup.

## A. Package readiness (extension/)

| # | Item | Notes |
|---|---|---|
| A1 ✓ | Icons | None exist. Need 16/32/48/128 PNG under `icons` and `action.default_icon`; the store requires the 128 in the package. Derive from the "W" launcher badge in `mocks/`. |
| A2 (dropped) | Gmail-only manifest | Per decision 2. Keep `optional_host_permissions: https://*/*` and `scripting`; both are used by the generic adapter (`activateGeneric`, `chrome.scripting.executeScript` in `background/index.ts`) and are justified as "on click only". |
| A3 (deferred) | Pin the extension id | Deferred until after the first store publish: the store assigns the id, then its public key goes into the dev manifest (`package.mjs` refuses a zip that carries `key`). The OpenRouter PKCE callback is `chrome.identity.getRedirectURL()`, which is derived from the id; a stable id keeps dev and store connect flows identical. |
| A4 ✓ | `npm run package` | Clean production build, assert the manifest carries no `(dev)` suffix and the bundle contains no mock-provider strings, zip to `wordsnap-<version>.zip`. Version read from one place (manifest) and checked against `package.json`. |
| A5 ✓ | Store screenshots | `scripts/screenshots.mjs` at `W=1280 H=800`: closed, loading, open panel, hover card, options page. 1 to 5 images, 1280x800. Small promo tile 440x280 is worth making (used in store placements). |
| A6 ✓ | Store copy | Name, 132-char summary, description (three passes, BYOK, no server, voice preserved), category Productivity / Workflow, English. Same voice rules as the UI: plain, specific, no praise. |
| A7 ✓ | Privacy tab | Single purpose: "analyze the draft you are writing in a compose window and show clarity, fact-check and counterargument findings". Permission justifications for `storage`, `activeTab`, `identity`, `scripting`, each host, and the optional `https://*/*`. Data disclosure: website content and personal communications (the draft) are transmitted to the provider the user chose, from the user's own account; authentication info (API key) stays in local storage. Certify: not sold, not used for unrelated purposes, not for creditworthiness. Privacy policy URL from C2. |
| A8 | Pre-submit QA | Fresh Chrome profile, install the zip as a normal user would, connect OpenRouter, run the sample, run a real draft in Gmail, Apply one change, undo with Ctrl+Z, uninstall. Then `npm run check` and `npm run test:e2e` on the release commit. |

## B. Open-source repo

| # | Item | Notes |
|---|---|---|
| B1 ✓ | LICENSE, NOTICE | Apache-2.0 text, copyright line from decision 3. |
| B2 ✓ | README | Spec section 9 privacy statement verbatim, store install link, install from source, one screenshot, status and known gaps, how to contribute, how to report a security issue. |
| B3 ✓ | CONTRIBUTING.md, SECURITY.md, issue templates | Bug template asks for site, provider, model and the `[wordsnap]` console lines. Security: private report path, no bounty. |
| B4 ✓ | CLAUDE.md | Keep it; it is a good contributor guide. Remove the "Founder:" line before the repo is public. |
| B5 ✓ | History audit | Done 2026-09-04: no provider keys in history, no personal email addresses in fixtures, src, mocks or docs. `test-results/`, `dist/`, `.env` are ignored. |
| B6 ✓ | CI | GitHub Actions: `npm run check` on push and PR; e2e job with the Playwright Chromium; release workflow on a `v*` tag that builds, zips and attaches to a GitHub Release. Replaces the manual `v0.1.0-dev.<sha>` pre-release pattern. |
| B7 | Flip to public | Repo description, homepage wordsnap.ai, topics (chrome-extension, writing, fact-checking, openrouter), branch protection on main. |

## C. Landing page (wordsnap.ai)

| # | Item | Notes |
|---|---|---|
| C1 ✓ | Where it lives | Recommendation: a static `site/` directory in this repo, deployed with Cloudflare Pages (DNS is already on Cloudflare). No framework. |
| C2 ✓ | Pages | `/`: one-line thesis ("Sharpen your own argument before you send it"), the three passes, a 20 second screen capture of the Gmail overlay, the privacy statement, Add to Chrome, Source on GitHub. `/privacy`: what is sent where, what is stored, no analytics, contact. `/terms`: short, no warranty, matches the license. |
| C3 ✓ | Assets | OG image 1200x630, favicon from A1, Chrome Web Store badge per Google's branding guidelines. |
| C4 ✓ | Copy | Same rules as the product. Do not describe it as an AI writer. |

## D. Submit and launch

| # | Item | Notes |
|---|---|---|
| D1 | Developer account | One-time $5 fee, 2-step verification on the Google account, verified contact email, publisher display name, trader declaration. Default limit is two extension slots per account. |
| D2 | Submit unlisted | Upload the A4 zip, fill A6 and A7, visibility Unlisted. Automated checks run on upload. Review takes days; host permissions and `scripting` can lengthen it. A staged submission can be held up to 30 days before publishing. |
| D3 | Dogfood the store build | Install from the unlisted link on two devices for a week. Fix, bump to 0.1.1, re-upload. |
| D4 | Go public | Flip visibility to Public (confirm whether that triggers a re-review), tag `v0.1.0`, GitHub Release, site goes live with the store link. |
| D5 | Announce | Show HN, X, LinkedIn. Store support URL points at GitHub issues. |
| D6 | After | Watch reviews and issues weekly. 0.2: X and LinkedIn adapters verified live, re-add hosts. |

## References

- Publishing overview: https://developer.chrome.com/docs/webstore/publish
- 2026 review and slot changes: https://developer.chrome.com/blog/cws-review-updates-2026
- Privacy tab: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Images: https://developer.chrome.com/docs/webstore/images
- Branding: https://developer.chrome.com/docs/webstore/branding
- Existing store item with the same name: https://chromewebstore.google.com/detail/mnjckcoeipkkndlmnimnmehejgadjmbo
