# WordSnap

Make your point. Keep your voice.

WordSnap helps you structure your thoughts, sharpen your wording, fact-check your claims and shows you the counterarguments, while preserving your voice. Like your very own ghostwriter and editor team. It turns your ideas into an authentic narrative, not AI slop. It works inside the Gmail, X or LinkedIn window you already write in, on Chrome and Safari.

- **Structure.** Your thesis as a reader will hear it, and where the narrative loses them.
- **Polish.** Fuzzy sentences, hedges, filler. A tighter phrasing inside your own sentence, in your register. Never a rewrite.
- **Check.** Every factual claim verified with sources: supported, contradicted, or needs precision.
- **Challenge.** The strongest counterargument, the blind spots, the gaps.

It never writes for you. It shows you the gap. A suggestion can only replace the words it quotes, stays close to their length, and keeps your register. Nothing changes in your draft until you click **Apply**. The wording for every public surface lives in `docs/MESSAGING.md`.

Quiet by default. A small badge appears on the compose window. Nothing is read or sent until you click it.

## Privacy

Your draft goes to the provider you chose, from your own account, and nowhere else. No WordSnap server, no analytics, no crash reporting, no account.

Works with your own OpenRouter account, connected with one click, running GLM 5.2. You pay OpenRouter, not WordSnap. GLM 5.2 served by Z.AI is the only model this build runs; its prompts and response parsing are validated against it alone. The key lives in the extension's local storage, is only ever read by the background service worker, and never reaches a web page. Full policy: [wordsnap.ai/privacy](https://wordsnap.ai/privacy).

## Install

From the Chrome Web Store and the Mac App Store: coming with 0.1. Until then, or to run the current source:

```
cd extension
npm install
npm run build          # Chrome: production build to extension/dist
npm run build:safari   # Safari: production build to extension/dist-safari
```

**Chrome.** Load `extension/dist` as an unpacked extension at `chrome://extensions` (Developer mode on).

**Safari.** On a Mac with Xcode, run `extension/scripts/safari-xcode.sh`, open the generated project in `safari/WordSnap`, run it once, then enable WordSnap in Safari > Settings > Extensions (Develop > Allow Unsigned Extensions first). Safari asks before the extension can read a site: choose Always Allow for Gmail and openrouter.ai. Details and the current caveats are in [docs/SAFARI.md](docs/SAFARI.md).

Either way, the settings page opens on first install: press **Connect OpenRouter** or paste a key, then open a Gmail compose window and click the **W** badge.

## Develop

```
npm run watch          # dev build with sourcemaps, rebuilds on change
npm run typecheck
npm test               # unit tests (vitest)
npm run test:e2e       # dev build + Playwright against test/fixtures/gmail-compose.html with the mock provider
npm run check          # typecheck + unit tests + production build
npm run package        # production build, dev-leak checks, wordsnap-<version>.zip for the store
npm run playground     # no extension load: fixtures + overlay + background in one page at http://127.0.0.1:8765/
```

The playground is the short loop: paste your own draft into a fixture composer, switch between the mock provider and your OpenRouter key, and open **Timings** in its strip for a waterfall of each run (per pass request: wait for the first token, reasoning, writing, repair, parse). Dev builds record the same traces and log one `[wordsnap] … timing run` line per run in the service worker console.

The panel can be dragged by its header; it remembers the spot per site, and a double-click on the header puts it back.

Dev builds add a mock provider (settings page) that returns canned findings for the sample draft, so the UI can be exercised without a key. Dev builds also open the overlay's shadow root so tests can reach it; production builds keep it closed.

[CLAUDE.md](./CLAUDE.md) is the guide for anyone, human or agent, changing the code: settled decisions, layout, invariants. [CONTRIBUTING.md](./CONTRIBUTING.md) covers the pull request bar. [SECURITY.md](./SECURITY.md) says how to report a vulnerability. `docs/SPEC.md` is the technical spec.

## Layout

```
extension/src
  background/   service worker: orchestrator, sessions, claim cache, settings, port and options handlers
  content/      content script: text snapshots, offset maps, session client
  adapters/     host adapters: gmail, x, linkedin, generic
  passes/       prompts, request builders, post-validation rules
  providers/    LLM providers: openrouter (the only one wired; web plugin, provider routing, JSON repair), claude (dormant), mock
  ui/           overlay (highlights, hover card, challenges panel, status pill)
  options/      settings page with one-click OpenRouter connect and guided key fallback
  shared/       schemas, types, message protocol, anchoring, cost, sample draft
extension/test
  unit/         vitest; DOM tests under unit/dom run in happy-dom
  fixtures/     saved composer DOMs for Gmail, X, LinkedIn
  e2e/          Playwright with the extension loaded in Chromium
site/           wordsnap.ai, static
store/          Chrome Web Store listing copy and screenshots
docs/           technical spec, release plan, Safari build notes
mocks/          the interactive design mock the UI was built against
```

## Status

0.1: Gmail end to end, X in daily use, LinkedIn adapter written against a saved DOM and not yet exercised on the live site. Chrome, and Safari from the same source (a developer build for now; the Mac App Store listing comes after the first round of testing on Safari). See `docs/SPEC.md` section 12 for milestones.

## License

[Apache-2.0](./LICENSE).
