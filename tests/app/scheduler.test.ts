import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { staggered, trailing } from '../../src/app/scheduler';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('trailing', () => {
  it('coalesces schedules and runs once after the delay', () => {
    const fn = vi.fn();
    const t = trailing(fn, 70);
    t.schedule();
    t.schedule();
    expect(t.pending).toBe(true);
    vi.advanceTimersByTime(70);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(t.pending).toBe(false);
  });
  it('flush runs a pending build immediately (once), and is a no-op otherwise', () => {
    const fn = vi.fn();
    const t = trailing(fn, 70);
    expect(t.flush()).toBe(false);
    t.schedule();
    expect(t.flush()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('staggered', () => {
  it('starts the first now and spaces the rest', () => {
    const seen: number[] = [];
    staggered([10, 11, 12], 150, (_, i) => seen.push(i));
    expect(seen).toEqual([0]);
    vi.advanceTimersByTime(150);
    expect(seen).toEqual([0, 1]);
    vi.advanceTimersByTime(150);
    expect(seen).toEqual([0, 1, 2]);
  });
});
