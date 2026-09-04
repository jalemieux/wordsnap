# WordSnap, notes for agents working in this repo

Read this before touching code. `docs/SPEC.md` is the long form; this file is what you need to not break things.

## What this is

A browser extension (Manifest V3; Chrome, plus a Safari build from the same source since September 2026) that sits on top of the composer a person is already typing in (Gmail first; X in daily use by the maintainer; the LinkedIn adapter is untested on the live site) and runs three analysis passes over the draft:

- **A. Clarity and claims**: fuzzy thinking, hedges, weak structure, plus extraction of every checkable claim. No research.
- **B. Fact check**: verifies each claim with web search, returns status, finding, confidence, sources, optional tighter wording.
- **C. Counterargument**: states the thesis, then argues back: strongest rebuttal, blind spots, gaps, with sources.

The user's words stay in the host editor. WordSnap draws over them and only writes into the editor when the user clicks **Apply change**. It is a sparring partner, not a ghostwriter, and the output must never read as AI slop.

The maintainer is a senior engineer. Speak as a peer. Prefer artifacts (a diff, a build, a page) over narration.

## Decisions already made (do not reopen without asking)

- Chrome first. Safari (milestone M4) started September 2026 at the founder's request: `npm run build:safari` derives a Safari manifest from the Chrome one, sign-in falls back to a tab when `chrome.identity` is missing, and the options page asks for site access per site. See `docs/SAFARI.md` for what is untested. Firefox stays out.
- No local inference. The user configures a provider. **OpenRouter is the default** (model `z-ai/glm-5.2`, pinned to provider slug `z-ai`, research through OpenRouter's web plugin), connected with one click via OAuth PKCE. Anthropic with a user's own API key is the alternative. Claude Code / claude.ai OAuth tokens are prohibited for third-party apps: never build on them.
- No separate search API (Brave was evaluated and dropped). Research is provider-native only.
- No WordSnap server in v1. Text goes only to the configured provider from the user's own account. A hosted service is the commercial path later and is designed as "one more provider".
- UX: inline highlights with hover cards (1A), docked Challenges panel (2B), Apply/Keep with diff preview (3A), **re-analysis on demand** (4A was silent re-analysis on edit; changed September 2026: edits shift anchors and mark touched findings stale immediately, but nothing runs until the user presses Re-analyze in the panel. The `autoAnalyze` setting, off by default, restores auto-start at 40 words and silent re-runs). The Re-analyze action never asks which pass: A runs on changed paragraphs, B on claims without a verdict, C always. **No share or export bar** (5A was built and dropped in September 2026: the user sends from the composer they are already in, and the panel summary row plus the launcher badge already carry the open-claim count). The Preview modal (5B) and `src/content/share.ts` are kept but unwired; they come back on X only, for thread splitting, once that adapter is proven.
- **Quiet by default.** Only a small launcher badge shows on a compose window. Nothing is sent anywhere until the user clicks it. A setting (off by default) restores auto-start at 40 words.
- **Setup is connect, check, done.** After a key lands (OAuth or paste) the options page runs one short completion through the configured route on its own, then shows "Setup complete" with a drawing of the badge to look for and an Open Gmail button. No model picker and no sample analysis in setup (both were removed September 2026; the model lives in settings, and `sample/run` stays in the background unused).
- **Voice preservation is a hard constraint.** A suggestion may only replace the quoted span, must stay within 1.3x its length, and must keep the writer's register. Prefer "here is the gap" over "here is your new sentence." Enforced in code (`src/passes/validate.ts`), not just in prompts.

## Layout

```
extension/               the extension (TypeScript strict, Preact, Zod 4, esbuild, vitest, Playwright)
  src/shared/            contracts: schemas.ts (Zod, source of truth), types.ts, messages.ts (port + sendMessage protocol),
                         anchoring.ts (quote location, span shifting), cost.ts, pkce.ts, sample.ts (the one sample draft), log.ts
  src/adapters/          HostAdapter + ComposerHandle per site: gmail, x, linkedin, generic. Select on ARIA/data-testid, never class names.
  src/content/           content script: text snapshots with offset maps, session client (port), entry that mounts the overlay
  src/ui/                overlay in a closed Shadow DOM (open in dev builds so tests can reach it): launcher, highlights, hover card,
                         challenges panel, status pill, toast. PreviewModal.tsx is unwired (see decisions). System fonts only; nothing loads from the network.
  src/background/        service worker (event page on Safari): orchestrator (debounce, incremental runs, claim cache, cancellation, backoff),
                         session state, settings store, port handler, options handler (validate key, OpenRouter connect, connection test,
                         sample run), auth-tab (sign-in in a tab for browsers without chrome.identity)
  src/passes/            prompts, request builders, post-validation rules
  src/providers/         LLMProvider implementations: openrouter (default), claude, mock (dev builds only)
  src/options/           settings page with one-click OpenRouter connect and guided key fallback
  test/unit/             vitest; files under test/unit/dom carry `// @vitest-environment happy-dom`
  test/fixtures/         saved composer DOMs (gmail-compose.html doubles as the e2e target)
  test/e2e/              Playwright loads the dev build into Chromium against the fixture with the mock provider
  scripts/build.mjs      esbuild; --dev adds sourcemaps, the mock provider, local fixture hosts, and an open shadow root;
                         --safari writes dist-safari/ with the manifest from scripts/manifest.mjs (event page, no identity)
  scripts/safari-xcode.sh macOS only: wraps dist-safari/ in the Xcode project Safari loads (docs/SAFARI.md)
  scripts/screenshots.mjs captures closed / loading / open overlay states (W= H= env for viewport)
docs/SPEC.md             technical spec (docs/spec.html is the rendered page; regenerate both together)
docs/SAFARI.md           the Safari build: how to load it, what differs, what is untested
mocks/                   the interactive design mock the UI was built against; the visual contract
```

## Commands

```
cd extension
npm run check        # typecheck + unit tests + production builds (Chrome and Safari)   <- run before every commit
npm run test:e2e     # dev build + Playwright (needs the Playwright Chromium: npx playwright install chromium)
npm run build        # production build to dist/; load dist/ unpacked at chrome://extensions
npm run build:safari # Safari build to dist-safari/; scripts/safari-xcode.sh wraps it on a Mac
npm run watch        # dev rebuild on change
```

`dist/` is gitignored and is whatever the last build produced. `test:e2e` leaves a **dev** build there; run `npm run build` again before handing a build to a person. A production manifest contains no `(dev)` suffix.

## Invariants (the things that make this trustworthy)

1. **Quotes, never offsets.** The model returns exact quotes; the extension locates them in the current snapshot. A finding whose quote cannot be located is dropped, not guessed. Anchors shift with edits via a real diff; a span whose text changed is marked stale and hidden.
2. **Source allowlist.** A cited URL must appear in that request's search results (`sourcesSeen`) or it is dropped. A verdict that loses all its sources becomes `unverifiable`. This is the anti-hallucination gate for citations.
3. **The API key never reaches a page context.** Only the background holds it. Content scripts talk to the background over a port and receive `SessionState`, nothing else.
4. **Nothing is written into the host editor except on Apply.** Edits go through `execCommand('insertText')` after selecting the range, so the host's own undo stack records them.
5. **Findings are display-only.** No finding can trigger an action other than the user clicking a button. The draft is treated as data; instructions inside it are content to analyze.
6. **Progressive, incremental, cancellable.** Pass A re-runs on changed paragraphs; B only on uncached claims (24h cache keyed by normalized statement); C on an explicit Re-analyze always, and in auto mode only when thesis or open-challenge anchors changed, at most every 20s. In auto mode a new edit aborts in-flight A. Grounded providers (OpenRouter) verify one claim per request.

## Provider notes

- OpenRouter: plain `fetch`, SSE streaming, `usage: {include: true}`, `plugins: [{id:'web', max_results}]` on research passes, `provider: {order:['z-ai'], allow_fallbacks:false}` when pinned. The Z.AI endpoint does **not** enforce JSON Schema: the schema is embedded in the system prompt, `json_object` mode is requested, output is parsed leniently (`src/providers/lenient.ts`: clip over-long strings and arrays to the schema caps, round and clamp numbers, prune the array items Zod issues point at, such as one bad source), validated with Zod, and one repair round fixes what remains. A parse failure logs `finish_reason` and the tail of the answer in the service worker console. Citations arrive as `url_citation` annotations.
- OpenRouter sign-in: `chrome.identity.launchWebAuthFlow` to `https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256`, then `POST /api/v1/auth/keys` with `{code, code_verifier, code_challenge_method}`. The key-exchange field names were confirmed against examples, not the doc page (it was down); if connect fails, look in `src/shared/pkce.ts` first.
- Claude: `@anthropic-ai/sdk` with `dangerouslyAllowBrowser`, `claude-opus-5`, adaptive thinking (send no `thinking` param), `output_config.format` from Zod, `web_search_20260318`, `pause_turn` continuation, refusal fallback. Follow the claude-api skill rules for anything Anthropic.
- Mock: returns the canned results in `src/shared/sample.ts`. Only offered in dev builds.

## Working conventions

- Every change to schemas or messages is additive unless the founder agrees otherwise; three parts (content, background, UI) depend on them.
- Keep the visual identity from `mocks/`: teal accent, red = contradicted, amber = needs precision, green = supported, dotted teal = clarity. Restrained. The user's words stay center stage.
- Copy is plain and specific. No praise, no "consider", no generic openers in prompts or UI.
- Logging is prefixed `[wordsnap]` and terse; page console for content, service worker console for background. Use it rather than adding debug UI.
- Tests: add a unit test with every rule or parser change; the e2e suite must stay green. Do not screenshot-loop; one visual check per change is enough.
- Commit messages: what and why, present tense. Run `npm run check` first. Push to `origin main` (github.com/jalemieux/wordsnap, private).

## Known gaps

- X and LinkedIn adapters have never run against the live sites. Draft.js accepting `insertText` on X is unverified.
- OpenRouter connect has not yet been exercised against the live OAuth endpoint by an automated test.
- The Safari build has never run in Safari (no Mac on the build box). Open questions are listed in `docs/SAFARI.md`.
- No license file yet (Apache-2.0 recommended). Trademark check on the name pending.
- Inline Gmail replies get a floating panel that overlaps the right side of the draft; a narrower rail mode is a candidate improvement.
