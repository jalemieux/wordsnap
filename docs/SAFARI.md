# WordSnap on Safari

Safari runs the same extension as Chrome from a second build target. This page is how to build it, load it, and what is different. Status as of September 2026: the build exists and its unit tests pass; it has not yet run in Safari, because the maintainer's build box is Linux and Safari needs a Mac.

## Build

```
cd extension
npm run build:safari        # dist-safari/
npm run package:safari      # wordsnap-safari-<version>.zip, the same folder zipped
```

`dist-safari/` differs from `dist/` in four ways, all applied by `scripts/manifest.mjs` and `scripts/build.mjs`:

- The background is a non-persistent event page (`background.scripts`) built as a classic script, not a module service worker. Safari has a known bug where `host_permissions` are ignored for service-worker backgrounds, and cross-origin fetch from a Safari service worker has been reported flaky.
- The `identity` permission is gone. Safari has no `chrome.identity`, so OpenRouter sign-in runs in a tab (below).
- `minimum_chrome_version` is gone and the settings page is declared as `options_ui`.
- The bundles target Safari 16.4, the first release with Manifest V3 service workers, `storage.session` and the `scripting` API.

## Load it in Safari

Two routes. Both need macOS.

**Xcode.** Run `extension/scripts/safari-xcode.sh` on a Mac with Xcode. It builds `dist-safari/` and runs `xcrun safari-web-extension-converter`, which writes an Xcode project to `safari/WordSnap/` (gitignored until it carries signing settings worth keeping). Open the project, run the WordSnap target once, then in Safari enable Develop > Allow Unsigned Extensions, and turn WordSnap on in Safari > Settings > Extensions. Distribution later is Mac App Store or a notarized download of that app.

**Develop menu.** Recent Safari versions can load an unpacked extension folder for development from the Develop menu (Add Temporary Extension). Point it at `dist-safari/`. Temporary extensions are dropped when Safari quits.

## What the user sees that Chrome users do not

**Site access is granted per site.** Chrome grants every host in the manifest at install. Safari grants nothing until the user allows it, on a prompt it only shows from a user gesture. The extension handles this in three places:

- The Connect OpenRouter button asks for `openrouter.ai` inside the click, before the sign-in tab opens, so the redirect back is visible to the extension.
- Opening the paste-a-key section asks for the OpenRouter host, so the key check and later analyses can reach it.
- Settings has a Site access card listing Gmail, X, LinkedIn and OpenRouter with an Allow button each. It is only rendered in Safari builds.

If the badge does not show on a Gmail compose window, the fix is to click the WordSnap icon in Safari's toolbar on that tab and choose Always Allow. The setup-complete screen says so in Safari builds.

**Sign-in opens a tab.** Without `chrome.identity` the OAuth flow cannot use a popup. The background opens `openrouter.ai/auth` in a tab with the callback set to `https://openrouter.ai/wordsnap/connected`, a path on a host the extension already reads. A top-level `tabs.onUpdated` listener catches the redirect, closes the tab before the page renders, exchanges the code for a key, stores it, and broadcasts an `openrouter/connected` message that the options page is waiting for. The pending sign-in (PKCE verifier, tab id) lives in `storage.session`, so it survives the event page unloading while the user is on the OpenRouter page. Closing the tab cancels; ten minutes without a redirect expires it (the code's own lifetime). This path is used whenever `chrome.identity` is absent, so it also serves any other browser without that API.

## The toolbar popup and other sites

Clicking the toolbar button opens `popup.html` on every target. On a site the manifest does not cover it offers **Use WordSnap here** (`chrome.scripting.executeScript` into the active tab under `activeTab`) and **Always on <origin>** (`chrome.permissions.request` for `https://host/*` from the optional host permissions, then `chrome.scripting.registerContentScripts` for that origin with `persistAcrossSessions`). The Safari manifest keeps the popup and the `scripting` permission as they are; `scripts/manifest.mjs` changes nothing for it. None of this has run in Safari: see the list below.

## Untested on the live browser

- **The popup.** Safari shows its own per-site access prompt from the toolbar button; whether it still does so when the button opens a popup, and whether `activeTab` then covers `executeScript` from the background, is unverified. If the prompt is lost, the Site access card in Settings is the fallback for the built-in sites.
- **Always on.** `chrome.permissions.request` for one origin out of `optional_host_permissions`, and `scripting.registerContentScripts` with `persistAcrossSessions`, are documented for Safari 16.4 and up but have not been exercised. If registration does not persist, the sync at browser start (`syncRegisteredSites`) re-registers from `settings.sites`; if the optional grant is refused, only "Use WordSnap here" works and the entry should say so.

- Whether `tabs.onUpdated` reports the redirect URL for `openrouter.ai` after the user has allowed that site. It should: Safari populates `changeInfo.url` for hosts the extension has permission for. If it does not, the fallback is adding the `tabs` permission to the Safari manifest.
- Whether OpenRouter's auth page accepts the callback path above. It accepted the arbitrary `chromiumapp.org` URL Chrome uses, so it should.
- Port lifetime across event-page unloads. The content script already reconnects and re-sends its snapshot; the session state is restored from `storage.session`.
- `execCommand('insertText')` on Gmail's editor in WebKit for Apply. Same code as Chrome.
- iOS is out of scope: mobile Gmail and X have different DOMs.

When any of these fail, log it here and on the fleet board before working around it.
