/**
 * Undo/redo over immutable snapshots. Docs share structure between versions,
 * so a snapshot costs only the changed pages and elements.
 *
 * `push(next, key)` with the same `key` as the previous push replaces that
 * entry instead of adding one, so a drag or a slider makes one undo step.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;

  constructor(public present: T, private limit = 200) {}

  push(next: T, key: string | null = null): void {
    if (next === this.present) return;
    if (key === null || key !== this.lastKey) {
      this.past.push(this.present);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.present = next;
    this.future = [];
    this.lastKey = key;
  }

  /** Stop coalescing: the next push starts a new step. */
  seal(): void {
    this.lastKey = null;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.present);
    this.present = prev;
    this.lastKey = null;
    return prev;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.present);
    this.present = next;
    this.lastKey = null;
    return next;
  }

  reset(present: T): void {
    this.past = [];
    this.future = [];
    this.present = present;
    this.lastKey = null;
  }
}
