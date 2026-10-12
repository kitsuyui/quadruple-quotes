import { textChange } from "../../../packages/analysis/src/diagnostic-tracking";
import type { Range } from "../../../packages/analysis/src/types";

export type EditKind = "typing" | "paste" | "fix" | "composition";
export type BodyEdit = { before: Range; after: Range; kind: EditKind };
type Entry = BodyEdit & {
  start: number;
  removed: string;
  inserted: string;
  time: number;
};

/** Draft-only replacement history. Fixes and compositions remain atomic steps. */
export class BodyHistory {
  private past: Entry[] = [];
  private future: Entry[] = [];

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
  record(
    before: string,
    after: string,
    selection: BodyEdit,
    time = Date.now(),
  ) {
    const change = textChange(before, after);
    if (!change) return;
    const entry: Entry = {
      ...selection,
      start: change.start,
      removed: before.slice(change.start, change.end),
      inserted: after.slice(change.start, change.start + change.insertedLength),
      time,
    };
    const last = this.past.at(-1);
    if (
      last?.kind === "typing" &&
      entry.kind === "typing" &&
      time - last.time <= 750 &&
      last.after.start === entry.before.start &&
      last.after.end === entry.before.end &&
      !last.removed &&
      !entry.removed &&
      !entry.inserted.includes("\n") &&
      entry.start === last.start + last.inserted.length
    ) {
      last.inserted += entry.inserted;
      last.after = entry.after;
      last.time = time;
    } else this.past.push(entry);
    this.future = [];
    // Bound both step count and retained replacement text, not full documents.
    let units = this.past.reduce(
      (sum, item) => sum + item.removed.length + item.inserted.length,
      0,
    );
    while (
      this.past.length > 1 &&
      (this.past.length > 200 || units > 1_000_000)
    ) {
      const removed = this.past.shift();
      if (removed) units -= removed.removed.length + removed.inserted.length;
    }
  }
  undo(text: string) {
    return this.move(text, false);
  }
  redo(text: string) {
    return this.move(text, true);
  }
  private move(text: string, redo: boolean) {
    const source = redo ? this.future : this.past;
    const target = redo ? this.past : this.future;
    const entry = source.at(-1);
    if (!entry) return null;
    const expected = redo ? entry.removed : entry.inserted;
    const replacement = redo ? entry.inserted : entry.removed;
    if (text.slice(entry.start, entry.start + expected.length) !== expected) {
      this.clear();
      return null;
    }
    source.pop();
    target.push(entry);
    return {
      text:
        text.slice(0, entry.start) +
        replacement +
        text.slice(entry.start + expected.length),
      selection: redo ? entry.after : entry.before,
    };
  }
}
