import type { FieldPointer } from './glyph-field';

// The existing cursor-light mousemove handler is the sole coordinate producer.
// Sharing numbers does not add another glow or change the light's DOM/styles.
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
