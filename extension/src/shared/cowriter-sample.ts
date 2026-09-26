// src/shared/cowriter-sample.ts
// Canned co-writer answers for the mock provider (dev builds, the playground, unit and e2e tests).
import type { PassFill, PassRevise, PassShape, PassTweak } from './schemas';

export const SAMPLE_SHAPE: PassShape = {
  note: 'Put in order: why, setup, first run, the reactive board, what is next. Fixed the spelling and grammar.',
  paragraphs: [
    { role: 'Why I tried it', sentences: [
      { text: 'I wanted to see whether a few Claude sessions could organize themselves without me directing them.', from: ['wanted to see if a few claude sessions could organize themselves without me micromanaging'] },
      { text: 'My bet was that they need less structure, not more.', from: ['actually no i think less structure is the point'] },
    ] },
    { role: 'The setup', sentences: [
      { text: 'So I kept the harness and the prompts thin, and did very little myself.', from: ['i was careful no to enforce toop much structure in the harness or in prompts', 'actually did very little'] },
      { text: 'Each bot had one instruction: fetch the latest instructions from the board when it starts.', from: ['simply instructed the bot to go fetch the latest instructions from the board whenever they start'] },
      { text: "Those instructions live in the board's /agents.md, which I could change as the board evolved.", from: ['the agents.md could be changed as neede don the board, as the board eveolved'] },
    ] },
    { role: 'First run', sentences: [
      { text: 'The first board was minimal: the bots introduced themselves and checked in now and then.', from: ['The first iteration was a very simple board with very simple inprompt to bot, instructing them to introudce themselve and look up the board every now and then'] },
      { text: 'Then I gave them a simple git-history cleanup task.', from: ['Then i had them work on a siomple git history cleaning task'] },
      { text: 'Almost at once they picked up work, delegated, and broke the task down on their own.', from: ['I immediatly notice how the bot would pick work and delegate and eventually orgnzie and break downt he worl'] },
      { text: 'That was the moment it clicked.', from: [], bridge: true },
    ] },
    { role: 'Making it reactive', sentences: [
      { text: 'Encouraged, I made the board reactive: a bot is notified when a message is posted to it directly, in a channel, or when another bot tags it.', from: ['with hthse encouraging results, i improve the board to be more reactive, where bopts would be notified when a message direct or in channel would be poseted. or that another bot would tag tham'] },
      { text: 'It ended up as a simple version of Slack, with websockets for prompt notification.', from: ['ended up with a board that is much like a simple version of slack, with webstockets to ensure prompt notification'] },
    ] },
    { role: 'Next', sentences: [{ text: 'Then I set them to work on a side project of mine, wordsnap.ai.', from: ['then set off to have them work on on a side project of my (wordsnap.ai)'] }] },
  ],
  choices: [{
    topic: 'how much structure the bots need',
    kept: 'actually no i think less structure is the point',
    other: 'maybe they need a lot of structure to get anywhere',
    paragraph: 0,
    sentence: 1,
    alt: { text: 'My worry was that they would need a lot of structure to get anywhere.', from: ['maybe they need a lot of structure to get anywhere'] },
  }],
  dropped: [{ quote: '(link to podcast from darkesh)', why: 'A link with no URL. Add it back when you have it.' }],
  missing: [{ what: 'What happened on the side project', after: 4 }],
};

export const SAMPLE_FILL: PassFill = { sentences: [{ text: 'What they did with it is the next part.', from: [] }] };

/** Any text but the agents dump: each paragraph kept as is, one sentence per sentence, every sentence its own source. */
export function mockShape(text: string): PassShape {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => ({ role: `Part ${i + 1}`, sentences: (p.match(/[^.!?]+[.!?]*/g) ?? [p]).map((s) => s.trim()).filter(Boolean).map((s) => ({ text: s.charAt(0).toUpperCase() + s.slice(1), from: [s] })) }));
  return { note: 'Kept your order; fixed nothing (mock).', paragraphs, choices: [], dropped: [], missing: [] };
}

const FILLER = /\b(really|actually|just|simply|very|quite)\s+/gi;

/** "say bot instead of persona", "instead of persona, use bot", "replace persona with bot": the pair, or null. */
export function parseRename(instruction: string): { from: string; to: string } | null {
  const w = '["“]?([A-Za-z][\\w-]*)["”]?';
  const pats: [RegExp, 'to-from' | 'from-to'][] = [
    [new RegExp(`\\b(?:use|say|write|call (?:it|them))\\s+${w}\\s+(?:instead of|rather than|not|in place of)\\s+${w}`, 'i'), 'to-from'],
    [new RegExp(`\\b(?:replace|swap)\\s+${w}\\s+(?:with|by|for)\\s+${w}`, 'i'), 'from-to'],
    [new RegExp(`\\binstead of\\s+(?:referring to\\s+|saying\\s+|using\\s+)?${w}\\b[^.]*?\\b(?:use|say|write|refer to)\\s+${w}`, 'i'), 'from-to'],
  ];
  for (const [re, order] of pats) {
    const m = instruction.match(re);
    if (!m) continue;
    const [a, b] = [m[1]!, m[2]!];
    return order === 'to-from' ? { to: a, from: b } : { from: a, to: b };
  }
  return null;
}

/** Every `from` in `text` becomes `to`, plural and initial capital kept. */
export function renameIn(text: string, from: string, to: string): string {
  const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s?)\\b`, 'gi');
  return text.replace(re, (m: string, s: string) => (m[0] === m[0]!.toUpperCase() ? to[0]!.toUpperCase() + to.slice(1) : to) + s);
}

export function mockTweak(passage: string, instruction = ''): PassTweak {
  const rename = parseRename(instruction);
  if (rename) {
    const renamed = renameIn(passage, rename.from, rename.to);
    return renamed === passage ? { replacement: passage, note: `"${rename.from}" is not in the text.` } : { replacement: renamed };
  }
  const trimmed = passage.replace(FILLER, '').replace(/\s{2,}/g, ' ').trim();
  if (trimmed !== passage.trim()) return { replacement: trimmed };
  const words = passage.trim().split(/\s+/);
  return { replacement: words.length > 3 ? words.slice(0, -1).join(' ').replace(/[,;:]$/, '') + '.' : `${passage.trim()} (mock)` };
}

/** A comment as the mock reads it back out of the request: numbered, on a quoted passage or on the whole draft. */
export interface MockComment {
  n: number;
  text: string;
  quote?: string;
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

/**
 * Canned Revise: a passage comment gets a rename, a "say: …" or the tweak stand-in; a whole-draft comment gets one
 * edit per sentence that holds the renamed term. Anything else is skipped with a reason, like the real pass would.
 */
export function mockRevise(draft: string, comments: MockComment[]): PassRevise {
  const out: PassRevise = { changes: [], edits: [], skipped: [] };
  for (const c of comments) {
    const rename = parseRename(c.text);
    if (c.quote !== undefined) {
      const say = c.text.match(/^say:?\s+(.+)$/i)?.[1];
      const replacement = rename ? renameIn(c.quote, rename.from, rename.to) : say ? say.trim() : mockTweak(c.quote, c.text).replacement;
      if (replacement === c.quote) out.skipped.push({ comment: c.n, why: 'Nothing here to change for that.' });
      else out.changes.push({ comment: c.n, replacement });
      continue;
    }
    if (!rename) {
      out.skipped.push({ comment: c.n, why: 'The mock only knows "say X instead of Y" on the whole draft.' });
      continue;
    }
    let hits = 0;
    for (const para of draft.split(/\n+/)) {
      for (const sentence of para.split(SENTENCE_SPLIT)) {
        const renamed = renameIn(sentence, rename.from, rename.to);
        if (renamed === sentence || !sentence.trim()) continue;
        out.edits.push({ comment: c.n, quote: sentence, replacement: renamed });
        hits += 1;
      }
    }
    if (!hits) out.skipped.push({ comment: c.n, why: `"${rename.from}" is not in the draft.` });
  }
  return out;
}
