# Submitting WordSnap to the Chrome Web Store, step by step

Do these in order. Copy text from `store/listing.md`. Everything happens in the developer dashboard at https://chrome.google.com/webstore/devconsole, signed in with the personal Google account that will own the listing.

## 1. Developer account (once, about 15 minutes)

1. Turn on 2-Step Verification for the Google account at https://myaccount.google.com/security. The dashboard refuses to publish without it.
2. Open https://chrome.google.com/webstore/devconsole and sign in.
3. Accept the developer agreement and pay the one-time $5 registration fee.
4. Account tab: set the publisher display name (shown on the listing), verify the contact email (a confirmation mail arrives, click it), and answer the trader declaration as **non-trader** (free extension, no commercial service).
5. Optional now, needed before the "official URL" can show: verify wordsnap.ai in Google Search Console with the same account.

## 2. Build the package (5 minutes)

```
cd extension
npm run check
npm run package
```

This writes `extension/wordsnap-0.1.0.zip` and prints its sha256. The script fails if the manifest version and package.json disagree, if icons are missing, if the build is a dev build, or if the manifest carries a `key`.

## 3. Create the item (10 minutes)

1. Dashboard, **Items**, **New item**, upload `wordsnap-0.1.0.zip`. Automated checks run on upload; fix anything they flag before going on.
2. **Store listing** tab: paste the name, summary and description from `listing.md`. Category Productivity, Workflow & Planning. Language English.
3. Same tab, images: store icon `extension/public/icons/icon-128.png`; screenshots `store/screenshots/01-badge.png` through `05-settings.png` in that order; small promo tile `store/promo-440x280.png`.
4. Same tab, links: homepage https://wordsnap.ai, support https://github.com/jalemieux/wordsnap/issues. Official URL only if step 1.5 is done.
5. Save draft.

## 4. Privacy tab (10 minutes)

1. Single purpose: paste the statement from `listing.md`.
2. Permission justifications: one box per permission and host. Paste each row of the table in `listing.md`. Do not leave any box empty; an empty justification is the most common rejection.
3. Remote code: **No**.
4. Data usage: tick **Personal communications**, **Website content**, **Authentication information**. Leave the rest unticked.
5. Certifications: tick all three (no sale to third parties, no unrelated use, no creditworthiness use).
6. Privacy policy URL: https://wordsnap.ai/privacy. The page must be live and reachable before you submit; reviewers open it.
7. Save draft.

## 5. Distribution tab (2 minutes)

1. Visibility: **Unlisted**.
2. Payments: free. Regions: all.
3. Save draft.

## 6. Submit (1 minute)

1. **Submit for review**. Leave "publish automatically after review" on; unlisted means only people with the link can find it.
2. Expect a review of a few days. The `scripting` permission and the optional `https://*/*` host can add time. Rejection mail goes to the contact email and names the policy; fix, bump to 0.1.1 in both `manifest.json` and `package.json`, repackage, upload the new zip on the item's **Package** tab, resubmit.

## 7. After the first publish (15 minutes)

1. Note the extension id from the item's store URL (`chromewebstore.google.com/detail/wordsnap/<id>`).
2. Restore the Add to Chrome button in `site/index.html` (the commented block above the GitHub link, with the store URL) and push; the site redeploys itself.
3. Pin the id for dev builds: item, **Package** tab, **View public key**. Add it as `"key": "<public key>"` to `extension/manifest.json` and make `scripts/build.mjs` strip it for production builds (the package script already refuses a zip that carries it). Unpacked dev builds then get the same id as the store build, so the OpenRouter callback URL is identical in both.
4. Install from the unlisted link on your devices. Use it for a week on real drafts in Gmail and X. Fix what you find, ship 0.1.1 the same way.

## 8. Go public (5 minutes)

1. Distribution tab, visibility **Public**, save. Check whether the dashboard asks for a new review; if it does, submit again.
2. Tag the release: `git tag v0.1.0 && git push origin v0.1.0`. The release workflow builds the zip and attaches it to a GitHub Release.
3. Flip the GitHub repo to public: Settings, Danger zone, Change visibility. Set the description, homepage wordsnap.ai, and topics first.
4. Announce where you like. The store support link already points at GitHub issues.

## Later versions

Bump the version in both `manifest.json` and `package.json`, `npm run package`, upload on the item's Package tab, submit. Nothing else on the listing needs to change unless permissions did, in which case update `listing.md` and the justification boxes together.
