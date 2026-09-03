# WordSnap

An AI layer that helps you sharpen your own argument before you send it. Not a ghostwriter: a sparring partner that runs three passes over your draft where you already write (Gmail first; X and LinkedIn adapters included) and leaves your voice alone.

- Clarity and structure: fuzzy thinking, hedges, weak structure.
- Fact check: every checkable claim, with sources and confidence.
- Counterargument: the strongest rebuttal, blind spots, gaps.

Your text goes only to the LLM provider you configure, from your own account. There is no WordSnap server. The default provider is OpenRouter (GLM 5.2 served by Z.AI), connected with one click; an Anthropic API key also works.

## In this repo

- `extension/`: the Chrome extension (Manifest V3, TypeScript, Preact, Zod, Anthropic SDK).
- `docs/SPEC.md`: technical spec v0.1. `docs/spec.html` is the same document as a standalone page.
- `mocks/wordsnap-mocks.html`: the interactive design mock the UI was built against.

## Run it

```
cd extension
npm install
npm run build          # production build to extension/dist
```

Load `extension/dist` as an unpacked extension at `chrome://extensions` (Developer mode on). Click the WordSnap icon to open settings, press **Connect OpenRouter** (or paste an OpenRouter or Anthropic key), then open a Gmail compose window. A small **W** badge appears at the top right of the compose frame; click it to analyze the draft.

## Develop

```
npm run watch          # dev build with sourcemaps, rebuilds on change
npm run typecheck
npm test               # unit tests (vitest)
npm run test:e2e       # dev build + Playwright against test/fixtures/gmail-compose.html with the mock provider
npm run check          # typecheck + unit tests + production build
```

Dev builds add a mock provider (settings page) that returns canned findings for the sample draft, so the UI can be exercised without a key. Dev builds also open the overlay's shadow root so tests can reach it; production builds keep it closed.

## Layout

```
extension/src
  background/   service worker: orchestrator, sessions, claim cache, settings, port and options handlers
  content/      content script: text snapshots, offset maps, session client, share helpers
  adapters/     host adapters: gmail, x, linkedin, generic
  passes/       prompts, request builders, post-validation rules
  providers/    LLM providers: openrouter (default; web plugin, provider routing, JSON repair), claude, mock
  ui/           overlay (highlights, hover card, challenges panel, export bar, preview modal)
  options/      settings page with guided key onboarding
  shared/       schemas, types, message protocol, anchoring, cost, sample draft
extension/test
  unit/         vitest; DOM tests under unit/dom run in happy-dom
  fixtures/     saved composer DOMs for Gmail, X, LinkedIn
  e2e/          Playwright with the extension loaded in Chromium
```

Status: M1 implemented (Gmail end to end, Chrome only). X and LinkedIn adapters exist but are untested against the live sites. See `docs/SPEC.md` section 12 for milestones and section 6 for the M0 verifications still open.
