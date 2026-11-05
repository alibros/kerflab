/** Small timing helpers for the app shell, kept free of DOM so they can be unit tested. */

export interface Trailing {
  /** Run `fn` after `delay` ms unless already scheduled (the run reads the latest state). */
  schedule(): void;
  /** Run `fn` now if a run is pending; no-op otherwise. Returns whether it ran. */
  flush(): boolean;
  readonly pending: boolean;
}

export function trailing(fn: () => void, delay: number): Trailing {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = (): void => {
    timer = undefined;
    fn();
  };
  return {
    schedule() {
      if (timer === undefined) timer = setTimeout(run, delay);
    },
    flush() {
      if (timer === undefined) return false;
      clearTimeout(timer);
      run();
      return true;
    },
    get pending() {
      return timer !== undefined;
    },
  };
}

/** Call `fn(item, i)` for each item, the first now and the rest `gap` ms apart. */
export function staggered<T>(items: T[], gap: number, fn: (item: T, i: number) => void): void {
  items.forEach((item, i) => {
    if (i === 0) fn(item, i);
    else setTimeout(() => fn(item, i), i * gap);
  });
}
