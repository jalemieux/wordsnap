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
  // OpenRouter. `searches` counts attached web results there, billed at $4 per 1,000 results.
  'z-ai/glm-5.2': { input: 0.966, output: 3.036, cacheRead: 0.078, searchPerThousand: 4 },
  'z-ai/glm-5.3': { input: 1.4, output: 4.4, cacheRead: 0.28, searchPerThousand: 4 },
  'z-ai/glm-5.3-flash': { input: 0.075, output: 0.25, cacheRead: 0.015, searchPerThousand: 4 },
  'z-ai/glm-5.1': { input: 0.966, output: 3.036, cacheRead: 0.078, searchPerThousand: 4 },
  'z-ai/glm-5': { input: 0.6, output: 1.92, cacheRead: 0.06, searchPerThousand: 4 },
  'anthropic/claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, searchPerThousand: 4 },
  'anthropic/claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, searchPerThousand: 4 },
};

const DEFAULT_PRICE: Price = PRICES['claude-opus-5']!;

export function priceFor(model: string): Price {
  if (PRICES[model]) return PRICES[model]!;
  const family = Object.keys(PRICES).find((k) => model.startsWith(k));
  if (family) return PRICES[family]!;
  // Unknown OpenRouter model: assume a mid-priced open model rather than Opus pricing.
  if (model.includes('/')) return { input: 1, output: 4, cacheRead: 0.1, searchPerThousand: 4 };
  return DEFAULT_PRICE;
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
