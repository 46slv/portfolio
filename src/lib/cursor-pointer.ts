import type { FieldPointer } from './glyph-field';

// The shared layout is the sole raw coordinate producer. Home eases its field
// light separately from immediate hit testing; other routes keep the DOM glow.
export const cursorPointer: FieldPointer = { x: 0, y: 0, active: false };
const subscribers = new Set<() => void>();

export function updateCursorPointer(x: number, y: number): void {
  cursorPointer.x = x;
  cursorPointer.y = y;
  cursorPointer.active = true;
  for (const subscriber of subscribers) subscriber();
}

export function clearCursorPointer(): void {
  cursorPointer.active = false;
  for (const subscriber of subscribers) subscriber();
}

export function subscribeCursorPointer(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}
