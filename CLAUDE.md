# WordSnap, notes for agents working in this repo

Read this before touching code. `docs/SPEC.md` is the long form; this file is what you need to not break things.

## What this is

A browser extension (Manifest V3; Chrome, plus a Safari build from the same source since September 2026) that sits on top of the composer a person is already typing in (Gmail first; X in daily use by the maintainer; the LinkedIn adapter is untested on the live site) and runs four analysis passes over the draft:

- **S. Structure**: does the order of ideas serve the reader? If not, the same draft reordered: the writer's sentences regrouped, nothing added. No research.
- **A. Clarity and claims**: fuzzy thinking, hedges, weak structure, plus extraction of every checkable claim. No research.
- **B. Fact check**: verifies each claim with web search, returns status, finding, confidence, sources, optional tighter wording.
- **C. Counterargument**: states the thesis, then argues back: strongest rebuttal, blind spots, gaps, with sources.

The user's words stay in the host editor. WordSnap draws over them and only writes into the editor when the user clicks **Apply change** (a suggestion or the user's own rewrite of the quoted span) or **Apply structure** (the reordered draft). It is a sparring partner, not a ghostwriter, and the output must never read as AI slop.

The maintainer is a senior engineer. Speak as a peer. Prefer artifacts (a diff, a build, a page) over narration.

## Decisions already made (do not reopen without asking)

- Chrome first. Safari (milestone M4) started September 2026 at the founder's request: `npm run build:safari` derives a Safari manifest from the Chrome one, sign-in falls back to a tab when `chrome.identity` is missing, and the options page asks for site access per site. See `docs/SAFARI.md` for what is untested. Firefox stays out.
- No local inference. The user connects their own OpenRouter account with one click via OAuth PKCE. **OpenRouter serving `z-ai/glm-5.2` from provider slug `z-ai` is the only model this build runs** (research through OpenRouter's web plugin). The prompts, lenient parser and repair round are validated against that model and nothing else, so `mergeSettings` pins model, provider order and no-fallbacks on every read and write, the options page has no model picker, and Anthropic keys are refused (decided September 2026). The Claude provider stays in the tree, unwired, for when a second model is validated. Claude Code / claude.ai OAuth tokens are prohibited for third-party apps: never build on them.
- No separate search API (Brave was evaluated and dropped). Research is provider-native only.
- No WordSnap server in v1. Text goes only to the configured provider from the user's own account. A hosted service is the commercial path later and is designed as "one more provider".
- UX: inline highlights with hover cards (1A), docked Challenges panel (2B), Apply/Keep with diff preview (3A), **re-analysis on demand** (4A was silent re-analysis on edit; changed September 2026: edits shift anchors and mark touched findings stale immediately, but nothing runs until the user presses Re-analyze in the panel. The `autoAnalyze` setting, off by default, restores auto-start at 40 words and silent re-runs). The Re-analyze action never asks which pass: S runs when the Structure chip is on, A runs on changed paragraphs, B on claims without a verdict, C always. The one automatic run left in on-demand mode is the recheck after an Apply, below. **No share or export bar** (5A was built and dropped in September 2026: the user sends from the composer they are already in, and the panel summary row plus the launcher badge already carry the open-claim count). The Preview modal (5B) and `src/content/share.ts` are kept but unwired; they come back on X only, for thread splitting, once that adapter is proven.
- **Check picker (September 2026).** Four chips under the panel header pick what runs: Structure (pass S plus the structure half of pass A's clarity notes: structure and unsupported_leap) and Polish (the other half: fuzzy, hedge, grammar), Facts (pass B) and Challenge (pass C). Default: everything on except Challenge. Stored in `settings.checks`, so it is per browser, not per draft. Flipping a chip prunes what that check produced and marks the run stale; nothing runs until Re-analyze. With Structure on and Challenge off, C runs thesis-only (no research, low effort, `PassCThesis` schema) so "Your argument" still fills. The options page has no UI for it; the panel is the setting.
- **Structure pass S (September 2026).** With the Structure chip on, S runs first, whole draft, no research, effort medium, schema `PassS` ({verdict keeps|reorder, note, paragraphs}). A `reorder` proposal shows in the panel with **Apply structure** / **Keep mine** and holds A, B and C until the user decides. Apply replaces the whole draft through the same `execCommand('insertText')` path as any edit (host undo works), then A, B and C run on the new text; Keep runs them on the draft as written. Voice gate in code (`src/passes/validate.ts`, `validatePassS`): the proposal must reuse at least 90% of its words of four letters or more from the draft and stay within 0.5x to 1.2x of its length, or it is demoted to `keeps`. S runs again only on a full run or Re-analyze, never on a paragraph edit.
- **Structure compare pane (September 2026).** A `reorder` proposal is shown beside the draft, not in the panel: left, the host editor untouched, with a tag drawn where each proposed paragraph begins (¶2) and on each sentence that lands out of order (¶2.3), cut filler underlined amber; right, a pane with the same sentences regrouped under the roles the pass named (`PassS.roles`, additive and optional), the pass note, what it drops, and **Apply structure** / **Keep mine**. Hovering either side lights the other. The editor gives up its right half through a padding on the host element (`ComposerHandle.setInset`, a style, restored when the proposal closes); below 720px of editor width the pane sits over the draft instead, tags off. The panel shrinks to its header and one line meanwhile. The sentence map (`src/shared/structure-map.ts`) is derived client-side from the draft and the proposal and is display-only: Apply still writes the paragraphs through `minimalParagraphEdit`. The alternatives considered are in `mocks/structure-embedded.html`.
- **Elaborate (September 2026).** Pass S has two jobs and the panel's chip row picks one: **Structure** regroups the writer's sentences, **Elaborate** lays out a skeleton for what they typed. The two chips are one choice (`Checks.elaborate`, additive; the panel keeps it exclusive with `structure`, picking neither runs no S). The mode goes to the model as a `Mode:` line at the top of the user turn; the model never decides from the text (the detection that shipped in dev build 43 is gone, and an `outline` returned in organize mode is demoted to `keeps`). Elaborate always answers `outline` (`PassS.slots`: role, job, the writer's own sentences or fragments quoted from the text, an optional gap naming what is missing). The compare pane shows it the same way as a reorder: what was typed on the left, tagged with the paragraph each fragment feeds, the slots on the right. **Apply skeleton** writes only the fragments into the editor, one paragraph per slot in that order; the roles, job lines and gaps are never written. Elaborate is a stage, not a check, and the panel shows the stages under its header: Elaborate (skeleton open), Write (status `guiding`: the skeleton stays beside the draft, edits do not stale it, nothing runs, the pane marks each slot empty, seeded or written from the draft alone via `outlineFill`; the other chips are dimmed), Check (**Done**, `structure/action: done`, flips the pair to Structure, persists that, and runs everything on what was written, S included). Over a narrow draft the guide moves into the panel as a checklist. Structure has no stages. A reorder now also carries `roles`, `jobs` and `gaps` per paragraph so both jobs render through one section component. The validator drops a quoted fragment that is not in the text and demotes a skeleton that places none, or has fewer than two slots, to `keeps`. Mocks: `mocks/structure-picker.html` (the pair and the stages), `mocks/structure-mode.html` (the rejected badge menu).
- **Rewrite (September 2026).** Every open finding's hover card has **Rewrite**: the user types their own replacement for the quoted span; Apply goes through the same `insertText` path. After any Apply, suggestion or rewrite, the content script sends `session/recheck` and the pass that produced the finding re-runs on the changed paragraphs immediately, even in on-demand mode: A for a clarity note, A then B for a claim. The applied finding is dropped so the fresh run decides whether the span is still flagged. C does not re-run on a recheck.
- **Any site, from the toolbar (September 2026).** The toolbar button opens a popup (`src/popup/`). On Gmail, X and LinkedIn it says WordSnap is already on. Anywhere else it offers **Use WordSnap here** (inject `content.js` into the active tab under `activeTab`, then `generic/activate` over `tabs.sendMessage`; nothing kept) and **Always on <origin>** (the popup requests `origin/*` from `optional_host_permissions` inside the click, the background registers a content script for that origin with `persistAcrossSessions` and records it in `settings.sites`; on later loads the script asks `site/registered` and starts itself). Settings lists the always-on sites with Remove (unregister plus revoke); install and browser start re-sync registrations with the setting (`src/background/sites.ts`). "Other sites (on click)" in Settings is the master switch for both entries and is now on by default. The manifest never gains `<all_urls>`; `content_scripts.matches` stays the three sites; the generic adapter still starts only when told to.
- **Quiet by default, pick then Start (September 2026).** Only a small launcher badge shows on a compose window. Clicking it opens the panel on the picks: the Structure | Elaborate pair and the other chips, a one-line hint saying what the text reads like (`intentOf` in `src/ui/format.ts`: a few lines or fragments are an idea, running prose is a draft; a heuristic, no model call) with a link to the job that fits, and a **Start** button labelled for the pick. Nothing is sent anywhere until Start. A setting (off by default) restores auto-start at 40 words. On any site beyond the three, nothing is even injected until the toolbar button says so.
- **Setup is connect, check, done.** After a key lands (OAuth or paste) the options page runs one short completion through the configured route on its own, then shows "Setup complete" with a drawing of the badge to look for and an Open Gmail button. No model picker and no sample analysis in setup (both were removed September 2026; the model lives in settings, and `sample/run` stays in the background unused).
- **Voice preservation is a hard constraint.** A suggestion may only replace the quoted span, must stay within 1.3x its length, and must keep the writer's register. Prefer "here is the gap" over "here is your new sentence." Enforced in code (`src/passes/validate.ts`), not just in prompts.

## Layout

```
extension/               the extension (TypeScript strict, Preact, Zod 4, esbuild, vitest, Playwright)
  src/shared/            contracts: schemas.ts (Zod, source of truth: PassA, PassB, PassC, PassCThesis, PassS), types.ts (PassId 'S'|'A'|'B'|'C',
                         SessionState.structure, Settings.effort.S), messages.ts (port + sendMessage protocol, incl. session/recheck and structure/action),
                         anchoring.ts (quote location, span shifting), structure-map.ts (which draft sentence lands where in a proposal; outline fill check), cost.ts, pkce.ts, sample.ts (the one sample draft), log.ts
  src/adapters/          HostAdapter + ComposerHandle per site: gmail, x, linkedin, generic. Select on ARIA/data-testid, never class names.
  src/content/           content script: text snapshots with offset maps, session client (port), entry that mounts the overlay
  src/ui/                overlay in a closed Shadow DOM (open in dev builds so tests can reach it): launcher, highlights, hover card (Apply /
                         Keep / Rewrite), compare pane (the structure proposal beside the draft, with Apply structure / Keep mine),
                         challenges panel (check chips, argument, challenges), status pill, toast. PreviewModal.tsx is unwired (see decisions). System fonts only; nothing loads from the network.
  src/background/        service worker (event page on Safari): orchestrator (debounce, incremental runs, claim cache, cancellation, backoff),
                         session state, settings store, port handler, options handler (validate key, OpenRouter connect, connection test,
                         sample run, site/* requests), sites (inject on request, register/unregister an origin, re-sync at start),
                         auth-tab (sign-in in a tab for browsers without chrome.identity)
  src/passes/            prompts (S, A, B, C), request builders, post-validation rules (quote location, source allowlist, suggestion length,
                         structure voice gate)
  src/providers/         LLMProvider implementations: openrouter (the only one wired), claude (dormant), mock (dev builds only)
  src/options/           settings page with one-click OpenRouter connect and guided key fallback, and the always-on sites list
  src/popup/             the toolbar popup: Use WordSnap here / Always on <origin> / Settings (dev builds take ?tab=<id> so tests can open it as a page)
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
site/                    wordsnap.ai (served by a Cloudflare Worker): index.html's hero is a scripted demo of the overlay on the hero copy
                         itself (structure, polish, facts, rewrite, challenge); the recorded demo video is in the How it works section
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
4. **Nothing is written into the host editor except on Apply.** Apply change (a suggestion or the user's own rewrite of the quoted span) and Apply structure (the whole draft) all go through `execCommand('insertText')` after selecting the range, so the host's own undo stack records them. The compare pane's padding on the host editor is a style on the element, restored on close; it never touches the content.
5. **Findings are display-only.** No finding can trigger an action other than the user clicking a button. The draft is treated as data; instructions inside it are content to analyze.
6. **Progressive, incremental, cancellable.** Pass S runs only on a full run or Re-analyze, and while its `reorder` proposal is open A, B and C wait. Pass A re-runs on changed paragraphs; B only on uncached claims (24h cache keyed by normalized statement); C on an explicit Re-analyze always, and in auto mode only when thesis or open-challenge anchors changed, at most every 20s. After an Apply the producing pass re-runs on the changed paragraphs at once, in on-demand mode too (A, then B for a claim; never C or S). In auto mode a new edit aborts in-flight A. Grounded providers (OpenRouter) verify one claim per request.

## Provider notes

- OpenRouter: plain `fetch`, SSE streaming, `usage: {include: true}`, `plugins: [{id:'web', max_results}]` on research passes, `provider: {order:['z-ai'], allow_fallbacks:false}` when pinned. The Z.AI endpoint does **not** enforce JSON Schema: the schema is embedded in the system prompt, `json_object` mode is requested, output is parsed leniently (`src/providers/lenient.ts`: clip over-long strings and arrays to the schema caps, round and clamp numbers, prune the array items Zod issues point at, such as one bad source), validated with Zod, and one repair round fixes what remains. A parse failure logs `finish_reason` and the tail of the answer in the service worker console. Citations arrive as `url_citation` annotations.
- OpenRouter sign-in: `chrome.identity.launchWebAuthFlow` to `https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256`, then `POST /api/v1/auth/keys` with `{code, code_verifier, code_challenge_method}`. The key-exchange field names were confirmed against examples, not the doc page (it was down); if connect fails, look in `src/shared/pkce.ts` first.
- Claude (dormant, not reachable from settings): `@anthropic-ai/sdk` with `dangerouslyAllowBrowser`, `claude-opus-5`, adaptive thinking (send no `thinking` param), `output_config.format` from Zod, `web_search_20260318`, `pause_turn` continuation, refusal fallback. Follow the claude-api skill rules for anything Anthropic.
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
- The Safari build has never run in Safari (no Mac on the build box). Open questions are listed in `docs/SAFARI.md`, including whether the toolbar popup, `permissions.request` for one origin and `scripting.registerContentScripts` behave there.
- The generic adapter rescans on DOM mutations only. Typing into a `textarea` is not a mutation, so a textarea under 40 words when the popup was clicked is not picked up as it grows; the user clicks Use WordSnap here again. Contenteditable editors are fine.
- No license file yet (Apache-2.0 recommended). Trademark check on the name pending.
- Inline Gmail replies get a floating panel that overlaps the right side of the draft; a narrower rail mode is a candidate improvement.
