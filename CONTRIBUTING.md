# Contributing

Read [CLAUDE.md](./CLAUDE.md) first. It is short, and it lists the decisions that are settled, the layout, and the invariants a change must not break. `docs/SPEC.md` is the long form.

## Setup

```
cd extension
npm install
npx playwright install chromium   # once, for the e2e suite and the icon script
npm run watch                      # dev build to dist/, rebuilds on change
```

Load `extension/dist` unpacked at `chrome://extensions` with Developer mode on. Dev builds add a mock provider in settings that returns canned findings for the sample draft, so you can work on the UI without a key.

## Before you open a pull request

```
npm run check      # typecheck, unit tests, production build
npm run test:e2e   # Playwright against test/fixtures/gmail-compose.html
```

Both must pass. Add a unit test with every rule or parser change. Files under `test/unit/dom` run in happy-dom and carry `// @vitest-environment happy-dom` at the top.

## What a good change looks like

- Schemas (`src/shared/schemas.ts`) and messages (`src/shared/messages.ts`) are shared by the content script, the background and the UI. Changes to them are additive unless discussed in an issue first.
- Host adapters select on ARIA roles and `data-testid`, never on class names. A new adapter comes with a saved composer DOM under `test/fixtures` and unit tests against it.
- Copy in the UI and in prompts is plain and specific: no praise, no "consider", no generic openers.
- Logging is prefixed `[wordsnap]` and terse. Use it instead of adding debug UI.
- Keep the visual identity from `mocks/`: teal accent, red for contradicted, amber for needs precision, green for supported, dotted teal for clarity.

Commit messages say what and why, in the present tense.

## Reporting bugs

Use the bug template. It asks for the site, the provider and model, and the `[wordsnap]` console lines (page console for the overlay, service worker console at `chrome://extensions` for the background). A draft that reproduces the problem is the single most useful thing you can attach.

## License

By contributing you agree that your contributions are licensed under the Apache License 2.0, the same license as the project.
