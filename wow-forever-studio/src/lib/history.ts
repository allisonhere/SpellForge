// Snapshot-based undo/redo. Drags coalesce: call `begin()` once, mutate freely, `commit()` on release.
export class History<T> {
  private past: string[] = [];
  private future: string[] = [];
  private pending: string | null = null;
  constructor(private limit = 200) {}
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  /** Record the state *before* a change. */
  begin(state: T) { if (this.pending === null) this.pending = JSON.stringify(state); }
  /** Finish the change; discards the snapshot if nothing actually changed. */
  commit(state: T): boolean {
    if (this.pending === null) return false;
    const before = this.pending;
    this.pending = null;
    if (before === JSON.stringify(state)) return false;
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    return true;
  }
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(prev) as T;
  }
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(JSON.stringify(current));
    return JSON.parse(next) as T;
  }
  clear() { this.past = []; this.future = []; this.pending = null; }
}
