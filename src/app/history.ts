/**
 * Undo/redo stack of snapshots. `record(before)` is called with the state *before* an edit.
 * Edits that share a gesture key and arrive within `window` ms of the previous one are coalesced
 * (a slider drag or a burst of typing is one entry); `break()` ends the current gesture.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;
  private lastTime = -Infinity;

  constructor(
    private readonly limit = 200,
    private readonly window = 1000,
  ) {}

  record(before: T, key?: string, now = Date.now()): void {
    const coalesce = key !== undefined && key === this.lastKey && now - this.lastTime <= this.window;
    this.lastKey = key ?? null;
    this.lastTime = now;
    if (coalesce) return; // the entry from the gesture's first edit already holds its "before"
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** Previous snapshot (and remembers `current` for redo), or undefined when there is none. */
  undo(current: T): T | undefined {
    const prev = this.past.pop();
    if (prev === undefined) return undefined;
    this.future.push(current);
    this.break();
    return prev;
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    this.break();
    return next;
  }

  break(): void {
    this.lastKey = null;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
