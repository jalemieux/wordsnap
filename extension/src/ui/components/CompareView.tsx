// The structure proposal beside the draft. Left is the host editor itself, untouched, with a small tag drawn at
// each point where a proposed paragraph begins (¶2) and at each sentence that lands out of order (¶2.3). Right is a
// pane with the same sentences regrouped under the roles the pass named. Hovering either side lights the other.
// When the editor is too narrow for two columns the pane sits over the draft instead, tags off.
//
// An outline (the text read as notes) uses the same two columns: each slot on the right is a paragraph to write,
// with its job, the writer's fragments that belong there and what the notes leave out. Once applied, the pane stays
// as a guide and marks each slot written or not from the draft alone.
import type { StructureSlot } from '../../shared/schemas';
import type { StructureResult } from '../../shared/types';
import type { SlotFill, StructureMap } from '../../shared/structure-map';
import type { RectLike } from './HighlightLayer';
import { Mark } from './bits';

export interface CompareGeometry {
  /** The pane, in viewport coordinates. */
  box: RectLike;
  /** Beside the draft (true) or over it (false). */
  wide: boolean;
  /** The editor's own type, so the proposal reads as the message will. */
  font: { family: string; size: string; lineHeight: string };
  /** Client rects per draft sentence (index into map.draft). Empty when the pane covers the draft. */
  sentences: RectLike[][];
  /** Client rects per draft sentence for the words the proposal cuts. */
  trims: (RectLike[] | null)[];
}

export interface CompareViewProps {
  structure: StructureResult;
  /** Paragraphs in the draft as written, for the "4 from 1" line. */
  fromParagraphs: number;
  map: StructureMap;
  geo: CompareGeometry;
  /** Outline guide only: how far each slot has been written. */
  fills?: SlotFill[];
  hotGroup: number | null;
  hotSentence: number | null;
  onHot: (group: number | null, sentence: number | null) => void;
  onApply?: (paragraphs: string[]) => void;
  onKeep?: () => void;
  onApplyOutline?: (paragraphs: string[]) => void;
  onDone?: () => void;
}

interface Pill {
  sentence: number;
  label: string;
  title: string;
  rect: RectLike;
  moved: boolean;
}

/** One tag where a proposed paragraph begins in the draft, and one on every sentence that lands out of order. */
export function pillsFor(map: StructureMap, roles: string[] | undefined, rects: RectLike[][]): Pill[] {
  const out: Pill[] = [];
  let prevPara = -1;
  map.draft.forEach((d, i) => {
    if (!d.dest) return;
    const starts = d.dest.para !== prevPara;
    prevPara = d.dest.para;
    const rect = rects[i]?.[0];
    if (!(starts || d.moved) || !rect) return;
    const role = roles?.[d.dest.para];
    const where = `paragraph ${d.dest.para + 1}${role ? ` (${role})` : ''}`;
    out.push(
      d.moved
        ? { sentence: i, label: `¶${d.dest.para + 1}.${d.dest.index + 1}`, title: `Moves to ${where}, sentence ${d.dest.index + 1}`, rect, moved: true }
        : { sentence: i, label: `¶${d.dest.para + 1}`, title: `Starts ${where}`, rect, moved: false },
    );
  });
  return out;
}

/** The text Apply outline writes: each slot's fragments as one paragraph, slots with nothing skipped. */
export function outlineParagraphs(slots: StructureSlot[]): string[] {
  return slots.map((s) => s.from.join(' ')).filter(Boolean);
}

function px(r: RectLike): Record<string, string> {
  return { top: `${r.top}px`, left: `${r.left}px`, width: `${Math.max(2, r.width)}px`, height: `${r.height}px` };
}

export const FILL_TEXT: Record<SlotFill, string> = { empty: 'Nothing here yet', seeded: 'Your fragment is in place; write the paragraph', written: 'Written' };

export function CompareView({ structure, fromParagraphs, map, geo, fills, hotGroup, hotSentence, onHot, onApply, onKeep, onApplyOutline, onDone }: CompareViewProps) {
  const outline = structure.verdict === 'outline';
  const guiding = outline && structure.status === 'guiding';
  const slots = structure.slots ?? [];
  const roles = outline ? slots.map((s) => s.role) : structure.roles;
  const cuts = map.draft
    .filter((d) => d.trim)
    .map((d) => d.text.slice(d.trim!.start - d.span.start, d.trim!.end - d.span.start).replace(/^[\s,;:]+|[\s,;:]+$/g, ''))
    .filter(Boolean);
  const droppedSentences = map.draft.filter((d) => !d.dest);
  const pills = geo.wide ? pillsFor(map, roles, geo.sentences) : [];
  const hotDraft = new Set<number>();
  if (hotSentence !== null) hotDraft.add(hotSentence);
  else if (hotGroup !== null) map.draft.forEach((d, i) => d.dest?.para === hotGroup && hotDraft.add(i));
  const written = fills?.filter((f) => f === 'written').length ?? 0;
  const empty = fills?.filter((f) => f === 'empty').length ?? 0;

  const sentenceSpans = (gi: number) =>
    (map.paragraphs[gi]?.sentences ?? []).map((s, si) => (
      <span
        key={si}
        class={`ws-cmp-sen${s.source !== null && hotSentence === s.source ? ' is-hot' : ''}${s.source === null ? ' new' : ''}`}
        title={s.source === null ? 'Not one of your sentences as written' : sourceTitle(map, s.source)}
        onMouseEnter={() => onHot(gi, s.source)}
        onMouseLeave={() => onHot(gi, null)}
      >
        {si ? ' ' : ''}
        {s.text}
      </span>
    ));

  return (
    <>
      {geo.wide ? (
        <div class="ws-cmp-layer" aria-hidden="true">
          {[...hotDraft].flatMap((i) => (geo.sentences[i] ?? []).map((r, k) => <div key={`h${i}:${k}`} class="ws-cmp-hot" style={px(r)} />))}
          {geo.trims.flatMap((rs, i) => (rs ?? []).map((r, k) => <div key={`t${i}:${k}`} class="ws-cmp-cut" style={px(r)} title="The proposal drops these words" />))}
          {pills.map((p) => (
            <button
              key={`p${p.sentence}`}
              class={`ws-cmp-pill${p.moved ? ' moved' : ''}${map.draft[p.sentence]!.dest?.para === hotGroup ? ' is-hot' : ''}`}
              style={{ top: `${p.rect.top + Math.max(0, (p.rect.height - 15) / 2)}px`, left: `${p.rect.left - 3}px` }}
              title={p.title}
              aria-label={p.title}
              onMouseEnter={() => onHot(map.draft[p.sentence]!.dest!.para, null)}
              onMouseLeave={() => onHot(null, null)}
              onFocus={() => onHot(map.draft[p.sentence]!.dest!.para, null)}
              onBlur={() => onHot(null, null)}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
      <section
        class="ws-compare ws-ia"
        data-mode={geo.wide ? 'beside' : 'over'}
        data-kind={outline ? 'outline' : 'reorder'}
        data-status={structure.status}
        aria-label={outline ? 'Proposed outline' : 'Proposed structure'}
        style={{ left: `${geo.box.left}px`, top: `${geo.box.top}px`, width: `${geo.box.width}px`, height: `${geo.box.height}px` }}
        onMouseLeave={() => onHot(null, null)}
      >
        <div class="ws-cmp-head">
          <Mark small />
          {guiding ? (
            <>
              <b>Writing into the outline</b>
              <span class="ws-cmp-sub">
                {written} of {slots.length} written{empty ? `, ${empty} still empty` : ''}.
              </span>
              {onDone ? (
                <div class="ws-cmp-acts">
                  <button class="ws-btn primary" data-act="outline-done" onClick={onDone} title="Close the outline and check what you wrote">
                    Done, check it
                  </button>
                </div>
              ) : null}
            </>
          ) : outline ? (
            <>
              <b>Outline</b>
              <span class="ws-cmp-sub">from your notes. {slots.length} paragraphs; your words go in each.</span>
              {onApplyOutline || onKeep ? (
                <div class="ws-cmp-acts">
                  {onKeep ? (
                    <button class="ws-btn" data-act="keep-structure" onClick={onKeep} title="Keep the notes as they are and check them as written">
                      Keep mine
                    </button>
                  ) : null}
                  {onApplyOutline ? (
                    <button
                      class="ws-btn primary"
                      data-act="apply-outline"
                      onClick={() => onApplyOutline(outlineParagraphs(slots))}
                      title="Put your fragments in this order in the editor and keep the outline beside them"
                    >
                      Apply outline
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <b>Proposed</b>
              <span class="ws-cmp-sub">
                {structure.paragraphs.length} paragraphs from {fromParagraphs}. Your sentences, regrouped; nothing added.
              </span>
              {onApply || onKeep ? (
                <div class="ws-cmp-acts">
                  {onKeep ? (
                    <button class="ws-btn" data-act="keep-structure" onClick={onKeep} title="Keep your order and check the draft as written">
                      Keep mine
                    </button>
                  ) : null}
                  {onApply ? (
                    <button class="ws-btn primary" data-act="apply-structure" onClick={() => onApply(structure.paragraphs)} title="Replace the draft with your sentences in this order">
                      Apply structure
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
        {!guiding ? <p class="ws-cmp-note">{structure.note}</p> : null}
        {!outline && (cuts.length || droppedSentences.length) ? (
          <p class="ws-cmp-cuts">
            {cuts.length ? (
              <>
                Drops{' '}
                {cuts.map((c, i) => (
                  <span key={i}>
                    {i ? ', ' : ''}“{c}”
                  </span>
                ))}
                {droppedSentences.length ? ' and ' : '.'}
              </>
            ) : null}
            {droppedSentences.length
              ? `${droppedSentences.length} ${droppedSentences.length === 1 ? 'sentence' : 'sentences'} the proposal leaves out${cuts.length ? '' : ' (they repeat one it keeps)'}.`
              : ''}
          </p>
        ) : null}
        {outline && !guiding && droppedSentences.length ? (
          <p class="ws-cmp-cuts">
            Not in the message:{' '}
            {droppedSentences.map((d, i) => (
              <span key={i}>
                {i ? ', ' : ''}“{d.text}”
              </span>
            ))}
            . Apply leaves {droppedSentences.length === 1 ? 'it' : 'them'} out.
          </p>
        ) : null}
        <div class="ws-cmp-body" style={{ fontFamily: geo.font.family, fontSize: geo.font.size, lineHeight: geo.font.lineHeight }}>
          {outline
            ? slots.map((sl, gi) => {
                const fill = fills?.[gi];
                const has = (map.paragraphs[gi]?.sentences.length ?? 0) > 0;
                return (
                  <section
                    key={gi}
                    class={`ws-cmp-sec ws-cmp-slot${hotGroup === gi ? ' is-hot' : ''}`}
                    data-group={gi}
                    data-fill={fill}
                    onMouseEnter={() => onHot(gi, null)}
                    onMouseLeave={() => onHot(null, null)}
                  >
                    <h4>
                      <b>¶{gi + 1}</b>
                      {sl.role}
                    </h4>
                    <p class="ws-cmp-job">{sl.job}</p>
                    {has ? <p>{sentenceSpans(gi)}</p> : null}
                    {guiding && fill ? <p class={`ws-cmp-fill ${fill}`}>{FILL_TEXT[fill]}</p> : null}
                    {sl.gap ? (
                      <p class={`ws-cmp-gap${fill === 'written' ? ' done' : ''}`}>
                        {fill === 'written' ? 'You flagged: ' : 'Missing: '}
                        {sl.gap}
                      </p>
                    ) : null}
                  </section>
                );
              })
            : map.paragraphs.map((p, gi) => {
                const moved = p.sentences.filter((s) => s.source !== null && map.draft[s.source]!.moved).length;
                const n = p.sentences.length;
                return (
                  <section key={gi} class={`ws-cmp-sec${hotGroup === gi ? ' is-hot' : ''}`} data-group={gi} onMouseEnter={() => onHot(gi, null)} onMouseLeave={() => onHot(null, null)}>
                    <h4>
                      <b>¶{gi + 1}</b>
                      {roles?.[gi] ?? ''}
                      <small>
                        {n} {n === 1 ? 'sentence' : 'sentences'}
                        {moved ? `, ${moved} moved` : ''}
                      </small>
                    </h4>
                    <p>{sentenceSpans(gi)}</p>
                  </section>
                );
              })}
        </div>
        <p class="ws-cmp-hint">
          {guiding
            ? 'Edits do not close the outline. Done runs the checks on what you wrote; so does Re-analyze.'
            : outline
              ? 'Apply writes only your fragments into the editor, in this order. The labels and the gaps stay here.'
              : 'Apply writes this order into the editor; undo there puts the draft back. Keep runs the checks on the draft as written.'}
        </p>
      </section>
    </>
  );
}

function sourceTitle(map: StructureMap, i: number): string {
  const d = map.draft[i]!;
  return d.moved ? `Moved: sentence ${i + 1} of your draft` : `Sentence ${i + 1} of your draft`;
}
