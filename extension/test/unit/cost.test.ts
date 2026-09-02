import { estimateCostUsd, formatUsd, priceFor } from '../../src/shared/cost';

describe('cost', () => {
  it('prices a full opus run in the expected range', () => {
    const usd = estimateCostUsd({ inputTokens: 40_000, outputTokens: 5_000, cacheReadTokens: 6_000, searches: 7 }, 'claude-opus-5');
    // 34k fresh in @5 = 0.17, 6k cached @0.5 = 0.003, 5k out @25 = 0.125, 7 searches = 0.07
    expect(usd).toBeCloseTo(0.368, 3);
  });
  it('falls back to opus prices for unknown models and family-matches prefixes', () => {
    expect(priceFor('claude-sonnet-5-20270101').input).toBe(2);
    expect(priceFor('something-else').input).toBe(5);
  });
  it('formats small and large amounts', () => {
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});
