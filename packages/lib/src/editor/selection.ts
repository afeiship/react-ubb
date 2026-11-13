import { Sel } from '../core/transform';

export interface Snapshot {
  source: string;
  selection: Sel;
}
// Snapshots are stored by reference — treat them as immutable (do not mutate
// an object after handing it to push/undo/redo).

export function getSelection(ta: HTMLTextAreaElement): Sel {
  return { start: ta.selectionStart, end: ta.selectionEnd };
}

// Replace [sel.start, sel.end) with text via ONE execCommand('insertText') call
// (single native undo unit). Falls back to setRangeText (returns false) when
// execCommand is unavailable (jsdom) or fails — caller then owns undo via UndoStack.
//
// Contract (callers must honor):
// - Does NOT check readOnly/disabled: setRangeText mutates a readOnly textarea
//   silently. Guard before calling.
// - Native path relies on execCommand firing a real `input` event to sync React
//   state; the fallback path fires none — callers must update state themselves
//   when false is returned (the two paths complement each other).
// - Steals focus and moves the caret (focus → setSelectionRange → execCommand
//   must stay in the same synchronous task for Safari).
export function replaceRange(
  ta: HTMLTextAreaElement,
  text: string,
  sel?: Sel,
  nextSel?: Sel,
): boolean {
  const range = sel ?? getSelection(ta);
  ta.focus();
  ta.setSelectionRange(range.start, range.end);
  let native = false;
  try {
    native = document.execCommand('insertText', false, text);
  } catch {
    native = false;
  }
  if (!native) ta.setRangeText(text, range.start, range.end, 'end');
  const target = nextSel ?? { start: ta.selectionStart, end: ta.selectionEnd };
  ta.setSelectionRange(target.start, target.end);
  return native;
}

export class UndoStack {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  push(s: Snapshot): void {
    this.past.push(s);
    if (this.past.length > 50) this.past.shift();
    this.future = [];
  }
  undo(current: Snapshot): Snapshot | undefined {
    const s = this.past.pop();
    if (s) this.future.push(current);
    return s;
  }
  redo(current: Snapshot): Snapshot | undefined {
    const s = this.future.pop();
    if (s) this.past.push(current);
    return s;
  }
}

// 'mod+k' (mod = Cmd/Ctrl) → keydown match; modifiers must match exactly
export function matchShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const needMod = parts.includes('mod');
  const needShift = parts.includes('shift');
  return (
    e.key.toLowerCase() === key &&
    (e.metaKey || e.ctrlKey) === needMod &&
    e.shiftKey === needShift
  );
}
