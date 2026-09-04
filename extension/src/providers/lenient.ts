// Lenient parsing of model output against a Zod schema, for endpoints that do not enforce JSON Schema.
// A model that overshoots a length cap, returns confidence 4.5, or cites one malformed URL should lose that
// field or that item, not the whole pass. Same rule as the anchoring gate: drop what is wrong, keep the rest.
//
// Order of operations, each step only if the previous did not validate:
//  1. find a JSON object in the text (fenced block, outermost braces, whole text), fixing trailing commas
//  2. coerce toward the JSON Schema we sent the model: clip over-long strings and arrays, round and clamp
//     numbers, drop nulls on optional fields, unwrap a single-key wrapper object
//  3. prune array items named by Zod issue paths (a bad source, a bad challenge) and validate again
import type { ZodType } from 'zod';
import { z } from 'zod';

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  maxLength?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  anyOf?: JsonSchema[];
}

export type Parsed<T> = { ok: true; data: T; notes: string[] } | { ok: false; error: string };

const MAX_PRUNE_ROUNDS = 8;

export function schemaFor<T>(schema: ZodType<T>): JsonSchema {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }) as JsonSchema;
}

export function parseJson<T>(text: string, schema: ZodType<T>, jsonSchema: JsonSchema = schemaFor(schema)): Parsed<T> {
  if (!text.trim()) return { ok: false, error: 'empty answer' };
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  candidates.push(text);

  let lastError = 'no JSON object found';
  for (const c of candidates) {
    let value: unknown;
    try {
      value = JSON.parse(c);
    } catch {
      try {
        value = JSON.parse(c.replace(/,\s*([}\]])/g, '$1'));
      } catch (e) {
        lastError = (e as Error).message;
        continue;
      }
    }
    // Strict first: a conforming answer carries no notes.
    const strict = schema.safeParse(value);
    if (strict.success) return { ok: true, data: strict.data, notes: [] };

    for (const candidate of unwrap(value, jsonSchema)) {
      const notes: string[] = [];
      const coerced = coerce(candidate, jsonSchema, notes, '');
      const r = prune(coerced, schema, notes);
      if (r.ok) return { ok: true, data: r.data, notes };
      lastError = r.error;
    }
  }
  return { ok: false, error: lastError };
}

/** The value itself, then the inner object if the model wrapped its answer in a single key ({"result": {...}}). */
function unwrap(value: unknown, s: JsonSchema): unknown[] {
  const out = [value];
  if (isRecord(value) && s.properties) {
    const keys = Object.keys(value);
    if (keys.length === 1 && isRecord(value[keys[0]!]) && !(keys[0]! in s.properties)) out.push(value[keys[0]!]);
  }
  return out;
}

function coerce(value: unknown, s: JsonSchema | undefined, notes: string[], path: string): unknown {
  if (!s) return value;
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  switch (type) {
    case 'string': {
      if (typeof value === 'number' || typeof value === 'boolean') value = String(value);
      if (typeof value !== 'string') return value;
      if (s.maxLength !== undefined && value.length > s.maxLength) {
        notes.push(`${path}: clipped ${value.length} to ${s.maxLength} chars`);
        return clip(value, s.maxLength);
      }
      return value;
    }
    case 'integer':
    case 'number': {
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) value = Number(value);
      if (typeof value !== 'number' || !Number.isFinite(value)) return value;
      let n = type === 'integer' ? Math.round(value) : value;
      if (s.minimum !== undefined && n < s.minimum) n = s.minimum;
      if (s.maximum !== undefined && n > s.maximum) n = s.maximum;
      if (n !== value) notes.push(`${path}: ${value} -> ${n}`);
      return n;
    }
    case 'array': {
      if (!Array.isArray(value)) return value;
      let arr = value.map((v, i) => coerce(v, s.items, notes, `${path}.${i}`));
      if (s.maxItems !== undefined && arr.length > s.maxItems) {
        notes.push(`${path}: kept ${s.maxItems} of ${arr.length} items`);
        arr = arr.slice(0, s.maxItems);
      }
      return arr;
    }
    case 'object': {
      if (!isRecord(value) || !s.properties) return value;
      const required = new Set(s.required ?? []);
      const out: Record<string, unknown> = { ...value };
      for (const [key, sub] of Object.entries(s.properties)) {
        if (!(key in out)) continue;
        const p = path ? `${path}.${key}` : key;
        if (out[key] === null && !required.has(key)) {
          notes.push(`${p}: dropped null`);
          delete out[key];
          continue;
        }
        out[key] = coerce(out[key], sub, notes, p);
      }
      return out;
    }
    default:
      return value;
  }
}

/** Cuts at a word boundary when one is reasonably close to the limit, and marks the cut. */
function clip(text: string, max: number): string {
  if (max <= 1) return text.slice(0, max);
  let cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  if (space > max * 0.6) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

/** Validates; on failure removes the array items that issues point into and tries again, a bounded number of times. */
function prune<T>(value: unknown, schema: ZodType<T>, notes: string[]): { ok: true; data: T } | { ok: false; error: string } {
  let r = schema.safeParse(value);
  for (let round = 0; !r.success && round < MAX_PRUNE_ROUNDS; round++) {
    const targets = new Map<string, (string | number)[]>();
    for (const issue of r.error.issues) {
      const idx = issue.path.map((p) => typeof p === 'number').lastIndexOf(true);
      if (idx < 0) continue;
      const p = issue.path.slice(0, idx + 1) as (string | number)[];
      targets.set(JSON.stringify(p), p);
    }
    if (targets.size === 0) break;
    // Deeper paths first, then higher indexes first, so removals never shift a path still to be removed.
    const ordered = [...targets.values()].sort((a, b) => b.length - a.length || (b.at(-1) as number) - (a.at(-1) as number));
    for (const p of ordered) {
      if (removeAt(value, p)) notes.push(`${p.join('.')}: dropped (did not match the schema)`);
    }
    r = schema.safeParse(value);
  }
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: issuesText(r.error) };
}

function removeAt(root: unknown, path: (string | number)[]): boolean {
  let node: unknown = root;
  for (const key of path.slice(0, -1)) {
    if (!isRecord(node) && !Array.isArray(node)) return false;
    node = (node as Record<string | number, unknown>)[key];
  }
  const idx = path.at(-1);
  if (!Array.isArray(node) || typeof idx !== 'number' || idx >= node.length) return false;
  node.splice(idx, 1);
  return true;
}

export function issuesText(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .slice(0, 6)
    .join('; ');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
