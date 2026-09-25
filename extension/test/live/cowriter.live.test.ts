// The gate: Shape and Tweak against z-ai/glm-5.2 on real dumps. Writes .live/report.md for a person to read.
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildFill, buildShape, buildTweak } from '../../src/passes/cowriter-build';
import { validateFill, validateShape, validateTweak } from '../../src/passes/cowriter-validate';
import { OpenRouterProvider } from '../../src/providers/openrouter';
import type { PassRequest } from '../../src/providers/types';
import { snapshotFromText } from '../../src/shared/anchoring';
import { shapedText, type Tune } from '../../src/shared/cowriter';
import { AGENTS_DUMP, DUMPS } from '../../src/shared/dumps';
import { SUPPORTED_MODEL, SUPPORTED_PROVIDER_ORDER } from '../../src/shared/types';

const key = process.env.OPENROUTER_API_KEY ?? '';
const TUNES: Tune[] = [
  { length: 'balanced', tone: 'neutral', for: 'post' },
  { length: 'tight', tone: 'formal', for: 'email' },
];
const out: string[] = ['# Co-writer gate report', '', `Model: ${SUPPORTED_MODEL}, ${new Date().toISOString()}`, ''];

async function timed<T>(p: OpenRouterProvider, req: PassRequest<T>) {
  const t0 = Date.now();
  const marks: string[] = [];
  const res = await p.runPass(req, new AbortController().signal, (e) => e.type === 'mark' && marks.push(`${e.mark} ${((Date.now() - t0) / 1000).toFixed(1)}s`));
  return { res, ms: Date.now() - t0, marks };
}

describe.skipIf(!key)('co-writer against GLM-5.2', () => {
  const p = new OpenRouterProvider({ apiKey: key, model: SUPPORTED_MODEL, providerOrder: [...SUPPORTED_PROVIDER_ORDER], allowFallbacks: false });

  afterAll(() => {
    mkdirSync('.live', { recursive: true });
    writeFileSync('.live/report.md', out.join('\n'));
  });

  for (const dump of DUMPS) {
    for (const tune of TUNES) {
      it(`shapes ${dump.id} at ${tune.length}/${tune.tone}/${tune.for}`, async () => {
        const { res, ms, marks } = await timed(p, buildShape(snapshotFromText(dump.text), tune));
        const v = validateShape(res.data, dump.text);
        const sentences = res.data.paragraphs.reduce((n, x) => n + x.sentences.length, 0);
        out.push(`## Shape: ${dump.label}, ${tune.length} · ${tune.tone} · ${tune.for}`, '', `${(ms / 1000).toFixed(1)}s (${marks.join(', ')}), ${res.usage.inputTokens} in / ${res.usage.outputTokens} out`, '');
        out.push(`Validation: ${v.ok ? 'kept' : 'REJECTED ' + v.reason}; ${v.notes.length} dropped of ${sentences}.`, ...v.notes.map((n) => `- ${n}`), '');
        if (v.ok) {
          out.push('```', shapedText(v.view, [], {}), '```', '');
          out.push(`Note: ${v.view.note}`, `Choices: ${v.view.choices.map((c) => `${c.topic} (kept "${c.kept}" over "${c.other}")`).join('; ') || 'none'}`);
          out.push(`Dropped: ${v.view.dropped.map((d) => `"${d.quote}" (${d.why})`).join('; ') || 'none'}`, `Missing: ${v.view.missing.map((m) => m.what).join('; ') || 'none'}`, '');
          if (v.view.missing[0]) {
            const f = await timed(p, buildFill({ dump: dump.text, shaped: shapedText(v.view, [], {}), gap: v.view.missing[0], tune }));
            out.push(`Fill "${v.view.missing[0].what}" (${(f.ms / 1000).toFixed(1)}s): ${validateFill(f.res.data, dump.text).join(' ') || 'nothing survived'}`, '');
          }
        }
        expect(res.data.paragraphs.length).toBeGreaterThan(0);
      });
    }
  }

  const PASSAGE = 'These instruction were amde availabel on the board, so the bot would only need a refrence to the board /agents.md file and would not need anymore details.';
  for (const instruction of ['Shorter', 'make it say why it matters', 'More formal']) {
    it(`tweaks a passage: ${instruction}`, async () => {
      const tune = TUNES[0]!;
      const { res, ms } = await timed(p, buildTweak({ draft: AGENTS_DUMP, passage: PASSAGE, instruction, tune }));
      const v = validateTweak(res.data, { passage: PASSAGE, draft: AGENTS_DUMP, instruction });
      out.push(`## Tweak: ${instruction}`, '', `${(ms / 1000).toFixed(1)}s, ${v.ok ? 'kept' : 'REJECTED ' + v.reason}`, '', `> ${res.data.replacement}`, '');
      expect(res.data.replacement.length).toBeGreaterThan(0);
    });
  }
});
