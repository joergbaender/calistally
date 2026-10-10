import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { raceIdle } from './idle';

describe('raceIdle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("resolves 'idle' when whenIdle settles before the timeout", async () => {
    let settle: () => void = () => undefined;
    const whenIdle = () => new Promise<void>((r) => { settle = r; });
    const result = raceIdle(whenIdle, 10_000);
    vi.advanceTimersByTime(9_999);
    settle();
    await expect(result).resolves.toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves 'timeout' when whenIdle is still pending after ms", async () => {
    const whenIdle = () => new Promise<void>(() => undefined);
    const result = raceIdle(whenIdle, 10_000);
    vi.advanceTimersByTime(10_000);
    await expect(result).resolves.toBe('timeout');
  });

  it('uses the given timers', async () => {
    const timers = { setTimeout: vi.fn(() => 'id'), clearTimeout: vi.fn() };
    await expect(raceIdle(() => Promise.resolve(), 10_000, timers)).resolves.toBe('idle');
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(timers.clearTimeout).toHaveBeenCalledWith('id');
  });
});
