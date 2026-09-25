# Co-writer: Tune, Shape, Tweak

Design, September 23 2026. Status: agreed in conversation with the founder, not built.

## Why

WordSnap was built for people who already write well: it critiques a finished draft and leaves the rewriting to them.
Used for real, the draft is a stream of consciousness: wrong words, broken grammar, ideas out of order and going back
and forth. The writer wants it organized and polished in one go, then wants to steer specific passages ("make this
land harder") and the whole ("tighter", "more serious"). Thirty dotted underlines on that draft are no help.

So WordSnap becomes a co-writer. The line it holds: **your ideas, its words.** Every idea in the output came from the
writer; the words may not.

| | Editor | **Co-writer** (this design) | Ghostwriter |
|---|---|---|---|
| Your words | kept | **replaced freely** (wrong word, grammar) | replaced |
| Your ideas | kept verbatim | **kept, merged, ordered** | a starting point |
| Back-and-forth | left in | **resolved to one side, shown, flippable** | resolved silently |
| New sentences | none | **bridges, transitions, gaps you ask to fill** | anything |
| New facts, claims, opinions, examples | none | **none unless you ask** | yes |

## Decisions this reopens

Recorded here so CLAUDE.md can be updated when the build lands:

- "Sparring partner, not a ghostwriter" becomes "co-writer": your ideas, its words.
- Structure pass S ("the writer's sentences regrouped, nothing added") and the 90% word-reuse gate: replaced by Shape
  and a source check (below).
- Elaborate: folded into Shape.
- The check picker (Structure, Elaborate, Polish, Facts, Challenge chips) and the picks-then-Start panel: replaced by
  Tune and the stage line.
- Pass A clarity notes (fuzzy, hedge, grammar, structure, unsupported leap): dropped. Grammar and structure are
  Shape's job, fuzzy wording and hedges are the dials' and Tweak's, unsupported leaps belong to Challenge.
- Rewrite on a hover card: replaced by Tweak on any selection.
- Automatic runs (auto-start at 40 words, silent re-runs on edits, the recheck after an Apply): gone. Nothing runs
  without a click.
- Facts (pass B) and Challenge (pass C): out of this release, shown as "soon". Their code is deleted with the rest;
  the Check stage gets its own design when it comes, and git history has the old passes if they are worth mining.

Unchanged: nothing is written into the host editor except on Apply, every Apply goes through
`execCommand('insertText')` (host undo works), quotes never offsets, the API key stays in the background, the draft
is data and never instructions, OpenRouter serving `z-ai/glm-5.2` is the only model.

## Clean slate

The co-writer is built fresh on the foundation, not adapted from the critique UI. Nothing from the old passes or
panel is kept "unwired" and no compatibility shims are written for old stored data.

**Delete** (files and their tests):

| Area | Files |
|---|---|
| Old passes | `src/passes/prompts.ts`, `build.ts`, `validate.ts` (contents; the files are rewritten for Shape and Tweak), `PassS`, `PassA`, `PassB`, `PassC`, `PassCThesis` in `src/shared/schemas.ts` |
| Claims | `src/background/cache.ts` (claim cache), `sample/run` in `options-handler.ts` |
| Findings state | the findings, anchors-for-findings and stale logic in `src/background/session.ts` (rewritten small) |
| Old panel | `src/ui/components/ChallengesPanel.tsx`, `CompareView.tsx`, `HoverCard.tsx`, `HighlightLayer.tsx`, `StatusPill.tsx`, `src/ui/format.ts` (checks, counts, intent hint, share text) |
| Structure | `src/shared/structure-map.ts`, the reorder and outline edits in `src/shared/anchoring.ts` (`minimalParagraphEdit`, `skeletonEdit`) |
| Unwired | `src/ui/components/PreviewModal.tsx`, `src/content/share.ts`, `src/providers/claude.ts` and the `@anthropic-ai/sdk` dependency |
| Samples | `src/shared/sample.ts` (replaced by canned Shape and Tweak for the mock provider) |
| Types | `Checks`, `CHECK_IDS`, `StructureResult`, clarity, claim, verdict and challenge types, `Settings.checks`, `Settings.effort.{S,A,B,C}` |
| Tests | `checks`, `claude-provider`, `outline`, `structure-map`, `structure`, `validate` (rewritten), `dom/share`, `dom/ui-hovercard`, `dom/ui-panel`, `dom/ui-preview`, `dom/ui-format`; `orchestrator`, `session` and `e2e/extension.spec.ts` are rewritten |

**Keep** (the foundation):

| Area | Files |
|---|---|
| Hosts | `src/adapters/*`, `src/content/text-snapshot.ts`, `src/content/session-client.ts`, `src/content/panel-pos.ts` |
| Text | `src/shared/anchoring.ts` (quote location, span shifting, `insertText` edits) |
| Background | `index.ts`, `port.ts`, `queue.ts`, `settings.ts`, `storage.ts`, `sites.ts`, `auth-tab.ts`, the orchestrator's cancellation, backoff and tracing (the file is rewritten around Shape and Tweak) |
| Model | `src/providers/openrouter.ts`, `lenient.ts`, `types.ts`, `index.ts`, `mock.ts` (new canned data) |
| Shared | `messages.ts` (rewritten message set, same port pattern), `pkce.ts`, `cost.ts`, `log.ts`, `trace.ts`, `globals.d.ts` |
| UI shell | `src/ui/overlay.tsx` (mount, layout, drag), `Launcher.tsx`, `Toast.tsx`, `bits.tsx`, `styles.css` (tokens and shell rules) |
| Pages | `src/options/*`, `src/popup/*`, `src/playground/*` |
| Tests | adapters, text-snapshot, session-client, anchoring, lenient, openrouter-provider, pkce, cost, connect, provider-test, queue, settings, sites, auth-tab, safari-manifest, playground-shim, panel-place, trace; `e2e/any-site.spec.ts` |

**Stored data.** `Settings` is rebuilt: the key and account, `sites`, `autoAnalyze` goes (nothing runs on its own),
the new `tune` map. `mergeSettings` drops every other field it finds. Saved sessions carry a format version; any
session saved by an older build is discarded on load.

**Docs.** `CLAUDE.md` (decisions, layout, invariants), `docs/SPEC.md` and `README.md` are rewritten for the
co-writer when it lands, not patched; `mocks/structure-*.html` and `mocks/wordsnap-mocks.*` move out of `mocks/`
since they no longer describe the product (git history keeps them).

## The flow

```
 DUMP ─────► TUNE ──────────► SHAPE ────────► TWEAK ──────────► CHECK (soon)
 raw text    length, tone,     one pass,       select a passage,  Facts, Challenge
             who it's for      uses the dials  say what you want
                                  ▲                 │
                                  └─ Tweak uses the same dials as its defaults
```

The panel header carries a stage line, **Tune · Shape · Tweak · Check**, like Elaborate's stages today. Any stage can
be jumped to: a draft already in shape goes straight to Tweak. Check is greyed with a "soon" label.

### Tune

The badge opens the panel on Tune:

```
┌ WordSnap ─────────────────────────────┐
│ Tune · Shape · Tweak · Check (soon)   │
├───────────────────────────────────────┤
│ Length   tight ◉───○───○ full         │
│ Tone     casual ○───◉───○ formal      │
│ For      [ post ▾ ]                   │
│                                       │
│ [ Shape my draft ]                    │
└───────────────────────────────────────┘
```

- Length: `tight | balanced | full`. Tone: `casual | neutral | formal`. For: `email | post | thread | doc`.
- Stored per origin in `settings.tune[origin]` (LinkedIn can default to formal), overridable per draft in the session.
- Tune comes before Shape because the dials are Shape's input. Changing a dial after Shape does not rewrite anything:
  it marks the shaped result stale and offers **Re-shape**, which replaces the whole proposal.

### Shape

**Shape my draft** runs one pass over the whole draft. The result opens in a compare pane (built fresh, in the place
the old one used): the dump on the left, untouched in the host editor; the shaped draft on the right, with **Apply**
and **Keep mine**. The editor makes room with the same `ComposerHandle.setInset` padding, restored on close.

- Hovering a shaped sentence lights its source fragments on the left, and hovering the dump lights the sentences
  that use it. The sources are the `from` quotes, located in the snapshot with `src/shared/anchoring.ts`; no sentence
  map is needed.
- Bridge sentences, the ones WordSnap wrote, are drawn in a distinct style so the writer sees what is not theirs.
- **Choices.** Where the dump goes back and forth, Shape picks a side and says so: "You went back and forth on X;
  I kept X." Each choice has a flip switch that swaps in the other side at once (no model call; see `alt` below).
- **Left out.** Fragments Shape dropped are listed with one line on why.
- **Missing.** On a sparse dump, Shape lists what the argument lacks ("Missing: why this matters"), each with
  **Fill this**, which asks for bridge sentences for that one gap. This is what Elaborate did.
- Apply replaces the draft through `insertText` over the whole text (one undo step in the host). Nothing runs
  afterwards. Keep closes the pane. Either moves the stage to Tweak.
- Below 720px of editor width the pane sits over the draft instead of beside it.

### Tweak

```
 1. select in the editor        2. click the pill                     3. result
 ─────────────────────          ─────────────────────────────         ──────────────────────────────
 …only need a reference         ┌─────────────────────────────────┐   ┌──────────────────────────────┐
  to /agents.md file…           │ ✎ make it say why it matters___ │   │ ~~only need a reference to~~ │
        └── ✎ Tweak             │ Shorter · Clearer · Punchier ·  │   │ just needed the one link:    │
                                │ Warmer · More formal       [↵]  │   │ the board's /agents.md…      │
                                └─────────────────────────────────┘   │ [Apply] [Again] [Keep]       │
                                                                      │ ✎ refine: "less formal"___   │
                                                                      └──────────────────────────────┘
```

- Any selection inside the composer shows a small **✎ Tweak** pill, drawn in the overlay. It does nothing until
  clicked.
- The pill opens an instruction box with presets (Shorter, Clearer, Punchier, Warmer, More formal) and free text.
  The dials go along as defaults; the instruction can override them for this passage. The box has a send button
  (**Tweak ↵**, and **Refine ↵** on a result), disabled while the box is empty; Enter does the same. A preset sends
  at once.
- The result card shows the change as a diff. **Apply** writes it through `insertText`. **Again** asks for a
  different version. **Refine** takes a new instruction on top of the last result without touching the draft.
  **Keep** closes the card. Nothing runs after an Apply.
- The selection travels as a quote (invariant 1). If the passage changed while the request was out, the card says
  "This passage changed; select it again" and applies nothing.
- Tweak works on the editor text, so an open Shape proposal must be applied or kept first.
- In the Tweak stage the panel shows the dials and the list of tweaks applied, each with its instruction.

## Passes and contracts

```
 Tune{length,tone,for} ─┐
 dump (snapshot) ───────┼─► SHAPE ──► validateShape ──► state.shape ──► compare pane → Apply (insertText)
                        │
 selection quote ───────┼─► TWEAK ──► validateTweak ──► state.tweak ──► diff card → Apply (insertText)
 instruction ───────────┘
```

Both are nodes that take a snapshot, the tune and (for Tweak) a quote and an instruction, and return validated data.
Neither knows about the UI; the orchestrator runs them only on a message from a click.

### Shape

Whole draft, no research, effort medium. The dials go to the model as a `Tune:` line at the top of the user turn,
the way `Mode:` does today.

```ts
PassShape {
  note: string                                   // one line: what it did
  paragraphs: {
    role?: string
    sentences: {
      text: string
      from: string[]                             // quotes from the dump this sentence says
      bridge?: boolean                           // written by WordSnap to connect; `from` may be empty
    }[]
  }[]
  choices: {
    topic: string
    kept: string                                 // quoted from the dump
    other: string                                // quoted from the dump
    at: [number, number]                         // paragraph, sentence that states the kept side
    alt: { text: string; from: string[] }        // that sentence written the other way
  }[]
  dropped: { quote: string; why: string }[]
  missing: { what: string; after: number }[]     // after paragraph index
}
```

**Fill this** is a small request per gap returning `{ sentences: { text, from, bridge: true }[] }`: at most three
sentences of at most 25 words, checked for unseen numbers, URLs and names like bridges, marked like them, and exempt
from the quarter cap because the writer asked for them.

### Tweak

Input: the draft for context, the selected span as a quote, the instruction, the tune. Output
`PassTweak { replacement: string; note?: string }`, for the span only.

### Checks in code (`src/passes/validate.ts`)

These replace the structure voice gate for Shape and Tweak.

1. **Sources.** A non-bridge sentence none of whose `from` quotes locates in the dump (normalized as for findings) is
   dropped. If fewer than half the sentences survive, the whole result is rejected and the panel says "Shape could
   not stay with your text; try again." No partial draft is shown.
2. **Bridges.** At most 25 words each, at most a quarter of all sentences (the extra ones, last first, are dropped).
   A bridge carrying a number, URL or capitalized name not present in the dump is dropped. This is "no new facts",
   mechanically.
3. **Choices.** `kept` and `other` must both locate in the dump; `at` must point at a surviving sentence; `alt` passes
   the sentence rules. A choice failing any of these is removed (the kept side stays in the draft).
4. **Dropped and missing** are display-only; a `dropped` quote that does not locate is removed.
5. **Tweak.** The replacement may not introduce a number, URL or capitalized name that is in neither the draft nor the
   instruction, and stays within 2.5x the span's length unless the instruction asks for more (longer, expand, add).
   A failing replacement is rejected with "That change added something you did not write; try again."

### State, settings, messages

Written fresh (see Clean slate); the additive-only rule starts again from this contract.

- `SessionState.shape?: { result: PassShape; status: 'open' | 'applied' | 'kept' | 'stale'; forVersion: number; flips: number[] }`
- `SessionState.tweak?: { quote: string; instruction: string; result?: PassTweak; status: 'running' | 'open' | 'stale' | 'error' }`
- `SessionState.tune?: Tune` (the per-draft override)
- `Settings.tune: Record<origin, Tune>`, `Tune = { length: 'tight'|'balanced'|'full'; tone: 'casual'|'neutral'|'formal'; for: 'email'|'post'|'thread'|'doc' }`
- Messages: `shape/run`, `shape/action` (`apply | keep | flip | fill`), `tweak/run` (`quote, instruction`),
  `tweak/action` (`apply | again | refine | keep`), `tune/set`.
- `PassId` is `'shape' | 'tweak'`.
- Timing traces (`src/shared/trace.ts`) cover the new passes with no change.

## Risk and the gate

The only validated model is GLM-5.2 and these are new prompts. Before any UI:

1. Run Shape and Tweak with GLM-5.2 in the playground on three real dumps (the agents.md draft plus two more).
2. Read the output with the founder and look at the Timings waterfall for cost and latency.
3. If the source quotes do not hold, change the schema before building on it.

**Gate result, 2026-09-24: passed.** GLM-5.2 on the three dumps at two tunes: 6/6 Shape results kept by validation,
all read as the writer's message, no invented numbers, names or links; 7 to 66 s per Shape. Carried into the build:
(a) a non-bridge sentence whose sources do not locate gets one re-quote request before it is dropped, and the raw
quotes go in the notes (one real idea was lost this way in the agents dump at balanced); (b) the Tweak prompt limits
"why" and "add" instructions to reasons already in the draft (one tweak added "without restarting anything").
Deferred to tuning with the UI: Tight barely tightens; long reasoning on formal email (66 s).

## Testing

- Unit: `validateShape` (sources, bridge caps, unseen names and numbers, choices, the half-survives floor),
  `validateTweak`, flip substitution, `tune` merge in settings, the `Tune:` line in the prompt builders.
- Mock provider: canned Shape and Tweak for the agents.md dump in `mocks/cowriter.html`, so the playground and e2e
  run without a key. The playground strip loses its auto-analyze box and gains that dump as its sample.
- e2e: dump, tune, Shape, Apply, select, Tweak, Apply; the provider sees exactly the requests the clicks asked for
  and nothing else.

## Out of scope for this release

Facts and Challenge (the Check stage), a docked rail for the panel, X thread splitting. See `docs/backlog.yaml`.
