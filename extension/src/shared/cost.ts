// Cost estimation from usage. List prices per million tokens, searches per thousand. Order-of-magnitude on purpose.
import type { PassUsage } from '../providers/types';

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  searchPerThousand: number;
}

const PRICES: Record<string, Price> = {
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, searchPerThousand: 10 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, searchPerThousand: 10 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, searchPerThousand: 10 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, searchPerThousand: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, searchPerThousand: 10 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, searchPerThousand: 10 },
};

const DEFAULT_PRICE: Price = PRICES['claude-opus-5']!;

export function priceFor(model: string): Price {
  if (PRICES[model]) return PRICES[model]!;
  const family = Object.keys(PRICES).find((k) => model.startsWith(k));
  return family ? PRICES[family]! : DEFAULT_PRICE;
}

/** USD for one pass. Cache-read tokens are assumed to be included in `inputTokens` and are re-priced at the cache rate. */
export function estimateCostUsd(usage: PassUsage, model: string): number {
  const p = priceFor(model);
  const cached = Math.min(usage.cacheReadTokens, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  const usd =
    (fresh * p.input) / 1e6 +
    (cached * p.cacheRead) / 1e6 +
    (usage.outputTokens * p.output) / 1e6 +
    (usage.searches * p.searchPerThousand) / 1000;
  return Math.round(usd * 1e6) / 1e6;
}

export function formatUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
