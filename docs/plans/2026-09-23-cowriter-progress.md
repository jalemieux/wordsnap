# Co-writer: where the work stands (handoff, 2026-09-25)

Branch `cowriter`. Plan: `docs/plans/2026-09-23-cowriter.md`. Spec: `docs/cowriter-design.md`. Mock: `mocks/cowriter.html`.

## State
- Tasks 1-6 done and reviewed (contracts, validators, prompts/builders, gate harness, dials per site, CowriterSession with the two gate fixes).
- Gate passed 2026-09-24 on GLM-5.2 (`OPENROUTER_API_KEY=… npm run live` writes `extension/.live/report.md`).
- Prototype wired (commit e8cd0de), built inline without per-task reviews at the founder's request: overlay in `src/ui/cowriter/`, port and content script on `CowriterSession`, mock answers, dumps in the playground. Old passes and panel still in the tree, unwired.
- Not done: plan Task 13 step 5 (deletes), Task 14 (e2e rewrite), Task 15 (docs). DOM tests for the new UI components were skipped. `dist/` is not rebuilt.

## Next up (founder feedback, 2026-09-24)
The Tweak card confuses when the model cannot do the change (e.g. "reference an article I read" with no article in the draft): it shows an unchanged diff, Apply/Again, "133% of the length", and the question hidden in the note. Proposed fix, not yet approved:
- `PassTweak` gains optional `question`; when set, the card shows only the question and an answer box (no diff, no Apply); the answer goes back as part of the instruction, so what the user supplies passes the no-new-facts check.
- Result card: "You asked: …" in plain text, no length %, buttons Apply / Try again / Cancel, refine box labelled "Change it further…".
- Open question to the founder: is the panel sitting apart during Tweak part of the problem?

## Ledger (copied from the git-ignored SDD workspace)
# SDD ledger — plan: docs/plans/2026-09-23-cowriter.md
Spec: docs/cowriter-design.md (read). Branch: cowriter (from main dc8cb55).

## Pre-flight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1→T2 | ShapeView, PassShape (paragraph/sentence fields) | consistent |
| T1→T6 | TraceTrigger + PassTrace.pass widened to CowriterPassId | consistent after plan fix dc8cb55 |
| T2→T6 | SHAPE_REJECTED / TWEAK_REJECTED strings; validateTweak({passage,draft,instruction}) | consistent with T6 tests |
| T3→T6 | buildTweak({draft,passage,instruction,tune,current,again}) | consistent; T6 test expects <current> block, matches |
| T4 | consumes T1-T3; mandates founder review of report | human checkpoint (see Ruling 3) |
| T5→T13 | Settings.tune/cleanTune/tuneFor; T13 rewrites mergeSettings keeping cleanTune | consistent |
| T6→T13 | CowriterSession API used by routeMessage | consistent |
| T7→T12,T14 | SAMPLE_SHAPE validates with 0 notes (checked quotes by hand); fill text; flip alt text | consistent with T12/T14 expectations |
| T8→T9..T12 | copy.ts, place.ts, diff.ts | consistent |
| T9→T12 | Panel props, busy() | consistent |
| T10→T12 | ShapePane props, PaneGeometry | consistent |
| T11→T12 | TweakCard/TweakPill props, selectionSpan | consistent |
| T12 self | overlay code passes `state={state as never}` to Launcher, but cleanup text says change Launcher to `busy` prop | inconsistency (Ruling 2) |
| T12 self | cardAt inline expression vs cardPosition helper | plan says replace; follow helper |
| T13 self | big switch; deletes after build green | plan note: split deletes if needed |
| T1..T3 self | tests match code (checked shapedText, validator counts, builder strings) | consistent |

## Rulings
- Ruling 1: work on branch `cowriter` in place, not a separate worktree — user said "go" and the repo convention is main; a branch isolates without a second node_modules — cost if wrong: a merge step the user must approve at the end.
- Ruling 2: Task 12 Launcher takes `busy: boolean` (the cleanup text), overlay passes busy(state) — the plan's own cleanup overrides its sketch — cost if wrong: one prop rename.
- Ruling 3: stop after Task 4's harness for the founder's OpenRouter key and report review; spec "Risk and the gate" mandates it before building on the prompts — cost if wrong: a pause.

## Progress
Task 1: minor (deferred): mock.ts MOCK_USAGE widened to CowriterPassId (needed for typecheck; T7/T13 rework it)
Task 1: minor (deferred): type-only import cycle cowriter.ts <-> trace.ts (erases at build)
Task 1: complete (commits dc8cb55..87eded3, review clean; Span verified present in types.ts by controller)
Task 2: minor (deferred): 50% survival floor counts after the bridge-share drop, conflating two rules (spec ambiguous; review in final)
Task 2: fix round 1/5 (code fix addressed; tests for misfire (a) and single-quote not covering, escapes not used — open; commits c53cfa5..6df685c)
Task 2: fix round 2/5 (2 addressed, 0 open — escapes pinned via new RegExp; Zeta/‘Hilton’ tests verified RED on c53cfa5 by reviewer; implementer's RED count was misreported; commits 6df685c..370c39c)
Task 2: complete (commits 87eded3..370c39c, review clean after 2 fix rounds)
Task 3: complete (commits 370c39c..909f7f3, review clean)
Task 4: minor (deferred): live config adds globals:true beyond the brief (needed; matches unit config)
Task 4: steps 1-4,6 complete (commits 909f7f3..5c39b99, review clean). Step 5 (founder gate review) PENDING — stopped for key + review (Ruling 3)
Ruling 4: leave Haiku-written commits with a "Claude Haiku 4.5" Co-Authored-By trailer instead of rewriting them to the Opus line — the credit is accurate and the branch is unpushed — cost if wrong: a history rewrite before merge
Task 4: complete (commits 909f7f3..<gate-doc commit>, founder passed the gate 2026-09-24)
Ruling 5: gate fix (a) (re-quote request before dropping a non-bridge sentence whose sources do not locate; raw quotes in notes) goes into Task 6 — founder accepted my recommendation — cost if wrong: one extra provider round trip per bad shape
Ruling 6: gate fix (b) (Tweak prompt limits why/add to reasons in the draft) goes into Task 6's dispatch as a prompt edit in cowriter-prompts.ts with a builder test — same — cost if wrong: prompt wording churn
Task 5: complete (commits e986818..1489342, review clean)
Ruling 7: founder asked for a testable prototype, not the full process ("not building a nuclear reactor"). After Task 6, the controller builds Tasks 7-13 wiring inline without per-task subagent reviews; deletes (T13 step 5), e2e (T14) and docs (T15) wait until the prototype is tested — cost if wrong: less review coverage on UI code; old code lingers unwired
