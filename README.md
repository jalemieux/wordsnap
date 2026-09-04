# WordSnap

Sharpen your own argument before you send it.

WordSnap is a Chrome extension that sits on top of the compose window you are already typing in (Gmail, X, LinkedIn) and runs three passes over the draft:

- **Clarity and claims.** Fuzzy thinking, hedges, weak structure, and every checkable claim you made.
- **Fact check.** Each claim verified with web search: supported, contradicted, or needs precision, with sources.
- **Counterargument.** The thesis as a reader will hear it, then the strongest rebuttal, the blind spots, the gaps.

It is a sparring partner, not a ghostwriter. Your words stay in the editor. WordSnap draws highlights over them and lists challenges in a docked panel. It writes into the editor only when you click **Apply change**, and a suggestion may only replace the quoted span and must keep your register.

Quiet by default: a small **W** badge appears on a compose window, and nothing is sent anywhere until you click it.

## Privacy

The draft text goes only to the provider the user configured, from the user's own account. No WordSnap server, no analytics, no crash reporting.

The default provider is OpenRouter (GLM 5.2 served by Z.AI), connected with one click. An Anthropic API key also works. The key lives in the extension's local storage, is only ever read by the background service worker, and never reaches a web page. Full policy: [wordsnap.ai/privacy.html](https://wordsnap.ai/privacy.html).

## Install

From the Chrome Web Store: coming with 0.1. Until then, or to run the current source:

```
cd extension
npm install
npm run build          # production build to extension/dist
```

Load `extension/dist` as an unpacked extension at `chrome://extensions` (Developer mode on). The settings page opens on first install: press **Connect OpenRouter** or paste a key, then open a Gmail compose window and click the **W** badge.

## Develop

```
npm run watch          # dev build with sourcemaps, rebuilds on change
npm run typecheck
npm test               # unit tests (vitest)
npm run test:e2e       # dev build + Playwright against test/fixtures/gmail-compose.html with the mock provider
npm run check          # typecheck + unit tests + production build
npm run package        # production build, dev-leak checks, wordsnap-<version>.zip for the store
```

Dev builds add a mock provider (settings page) that returns canned findings for the sample draft, so the UI can be exercised without a key. Dev builds also open the overlay's shadow root so tests can reach it; production builds keep it closed.

[CLAUDE.md](./CLAUDE.md) is the guide for anyone, human or agent, changing the code: settled decisions, layout, invariants. [CONTRIBUTING.md](./CONTRIBUTING.md) covers the pull request bar. [SECURITY.md](./SECURITY.md) says how to report a vulnerability. `docs/SPEC.md` is the technical spec.

## Layout

```
extension/src
  background/   service worker: orchestrator, sessions, claim cache, settings, port and options handlers
  content/      content script: text snapshots, offset maps, session client
  adapters/     host adapters: gmail, x, linkedin, generic
  passes/       prompts, request builders, post-validation rules
  providers/    LLM providers: openrouter (default; web plugin, provider routing, JSON repair), claude, mock
  ui/           overlay (highlights, hover card, challenges panel, status pill)
  options/      settings page with one-click OpenRouter connect and guided key fallback
  shared/       schemas, types, message protocol, anchoring, cost, sample draft
extension/test
  unit/         vitest; DOM tests under unit/dom run in happy-dom
  fixtures/     saved composer DOMs for Gmail, X, LinkedIn
  e2e/          Playwright with the extension loaded in Chromium
site/           wordsnap.ai, static
store/          Chrome Web Store listing copy and screenshots
docs/           technical spec, release plan
mocks/          the interactive design mock the UI was built against
```

## Status

0.1: Gmail end to end, X in daily use, LinkedIn adapter written against a saved DOM and not yet exercised on the live site. Chrome only; Safari is a later milestone. See `docs/SPEC.md` section 12 for milestones.

## License

[Apache-2.0](./LICENSE).
