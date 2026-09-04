import { describe, expect, it } from 'vitest';
import { serialQueue } from '../../src/background/queue';

describe('serialQueue', () => {
  it('runs tasks in submission order even when an earlier one awaits longer', async () => {
    const enqueue = serialQueue();
    const order: string[] = [];
    enqueue(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('open');
    });
    enqueue(async () => {
      order.push('snapshot');
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(order).toEqual(['open', 'snapshot']);
  });

  it('keeps going after a task rejects and reports the error', async () => {
    const errors: unknown[] = [];
    const enqueue = serialQueue((e) => errors.push(e));
    const order: string[] = [];
    enqueue(async () => {
      throw new Error('boom');
    });
    enqueue(async () => {
      order.push('next');
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['next']);
    expect(errors).toHaveLength(1);
  });
});
