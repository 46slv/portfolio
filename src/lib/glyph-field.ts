/** Pure field and transition math, shared with the focused Node tests. */
export interface FieldPointer {
  x: number;
  y: number;
  active: boolean;
}

export const POINT_BUDGET = 2600;
export const MAX_DPR = 2;
export const GLYPH_ATLAS_TILE_SIZE = 32;
export const FIELD_PADDING = 32;
export const EDGE_FADE = 18;
export const POINT_VELOCITY = { x: 1.8, y: 1.2 };
export const GRADIENT_VELOCITY = { x: 2.4, y: 1.6 };

export interface FieldPoint {
  x: number;
  y: number;
}

/** Two RGBA atlases, independent of viewport DPR: at most 20.32 MiB total. */
const maxAtlasColumns = Math.ceil(Math.sqrt(POINT_BUDGET));
export const GLYPH_ATLAS_MAX_BYTES = 2 * maxAtlasColumns * Math.ceil(POINT_BUDGET / maxAtlasColumns)
  * GLYPH_ATLAS_TILE_SIZE ** 2 * 4;

export function glyphAtlasLayout(pointCount: number): { width: number; height: number; columns: number; bytes: number } {
  const count = Math.max(1, Math.min(POINT_BUDGET, Math.floor(Number.isFinite(pointCount) ? pointCount : 1)));
  const columns = Math.ceil(Math.sqrt(count));
  const width = columns * GLYPH_ATLAS_TILE_SIZE;
  const height = Math.ceil(count / columns) * GLYPH_ATLAS_TILE_SIZE;
  return { width, height, columns, bytes: 2 * width * height * 4 };
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};

// Preserve the existing 2.6x spatial detail and 6x color evolution. A separate
// common translation carries that evolving field diagonally down and right.
const FIELD_SPATIAL_SCALE = 2.6;
const EVOLUTION_RATES = [0.13 * 6, -0.09 * 6, 0.07 * 6];
const TRANSLATION_RATES = [
  -FIELD_SPATIAL_SCALE * (GRADIENT_VELOCITY.x / 285 + GRADIENT_VELOCITY.y / 410),
  -FIELD_SPATIAL_SCALE * (GRADIENT_VELOCITY.y / 240 - GRADIENT_VELOCITY.x / 610),
  -FIELD_SPATIAL_SCALE * (GRADIENT_VELOCITY.x / 510 - GRADIENT_VELOCITY.y / 330),
];
const TAU = Math.PI * 2;
const wrap = (value: number, span: number) => {
  const remainder = value % span;
  return remainder < 0 ? remainder + span : remainder;
};
const advanceCycle = (value: number, rate: number, elapsed: number, span: number) =>
  wrap(value + (elapsed % (span / Math.abs(rate))) * rate, span);

export interface FieldMotion {
  offsetX: number;
  offsetY: number;
  evolution: number[];
  translation: number[];
}

export function createFieldMotion(): FieldMotion {
  return { offsetX: 0, offsetY: 0, evolution: [0, 0, 0], translation: [0, 0, 0] };
}

/** Bounded shared offsets/phases, never an accumulating world coordinate.
 * Zero elapsed normalizes offsets after resize without restarting motion. */
export function advanceFieldMotion(motion: FieldMotion, elapsed: number, width: number, height: number): void {
  const delta = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  motion.offsetX = advanceCycle(motion.offsetX, POINT_VELOCITY.x, delta, width + 2 * FIELD_PADDING);
  motion.offsetY = advanceCycle(motion.offsetY, POINT_VELOCITY.y, delta, height + 2 * FIELD_PADDING);
  for (let index = 0; index < 3; index++) {
    motion.evolution[index] = advanceCycle(motion.evolution[index], EVOLUTION_RATES[index], delta, TAU);
    motion.translation[index] = advanceCycle(motion.translation[index], TRANSLATION_RATES[index], delta, TAU);
  }
}

/** Evolving grayscale plus common diagonal advection. Pointer light stays in
 * screen coordinates. Numeric time remains available for pure sampling tests. */
export function sampleLuminance(x: number, y: number, time: number | FieldMotion, pointer: FieldPointer): number {
  const fieldX = x * FIELD_SPATIAL_SCALE;
  const fieldY = y * FIELD_SPATIAL_SCALE;
  const seconds = typeof time === 'number' && Number.isFinite(time) ? time : 0;
  const evolution = typeof time === 'number'
    ? EVOLUTION_RATES.map((rate) => advanceCycle(0, rate, seconds, TAU)) : time.evolution;
  const translation = typeof time === 'number'
    ? TRANSLATION_RATES.map((rate) => advanceCycle(0, rate, seconds, TAU)) : time.translation;
  const field = 0.46
    + 0.30 * Math.sin(fieldX / 285 + fieldY / 410 + evolution[0] + translation[0])
    + 0.23 * Math.cos(fieldY / 240 - fieldX / 610 + evolution[1] + translation[1])
    + 0.17 * Math.sin(fieldX / 510 - fieldY / 330 + evolution[2] + translation[2]);
  const distanceSquared = (x - pointer.x) ** 2 + (y - pointer.y) ** 2;
  const pointerLight = pointer.active ? 0.82 * Math.exp(-distanceSquared / (2 * 105 ** 2)) : 0;
  return smoothstep(0.26, 0.87, field + pointerLight);
}

/** A uniform torus extends beyond every screen edge. Recycling occurs only in
 * the invisible padding; point count and spacing stay bounded across wraps. */
export function makeGrid(width: number, height: number): FieldPoint[] {
  const spanX = width + 2 * FIELD_PADDING;
  const spanY = height + 2 * FIELD_PADDING;
  const spacing = Math.max(22, Math.sqrt(spanX * spanY / POINT_BUDGET));
  const columns = Math.min(POINT_BUDGET, Math.max(1, Math.floor(spanX / spacing)));
  const rows = Math.min(Math.floor(POINT_BUDGET / columns), Math.max(1, Math.floor(spanY / spacing)));
  return Array.from({ length: columns * rows }, (_, index) => ({
    x: -FIELD_PADDING + (index % columns + 0.5) * spanX / columns,
    y: -FIELD_PADDING + (Math.floor(index / columns) + 0.5) * spanY / rows,
  }));
}

export function pointPosition(point: FieldPoint, motion: FieldMotion, width: number, height: number): { x: number; y: number } {
  return {
    x: wrap(point.x + FIELD_PADDING + motion.offsetX, width + 2 * FIELD_PADDING) - FIELD_PADDING,
    y: wrap(point.y + FIELD_PADDING + motion.offsetY, height + 2 * FIELD_PADDING) - FIELD_PADDING,
  };
}

export function pointVisibility(x: number, y: number, width: number, height: number): number {
  const fade = Math.min(EDGE_FADE, width / 4, height / 4);
  return fade > 0 ? smoothstep(0, fade, Math.min(x, y, width - x, height - y)) : 0;
}

/** One visible sample owns drawing, text readability and transition delays. */
export function samplePoint(point: FieldPoint, motion: FieldMotion, width: number, height: number, pointer: FieldPointer) {
  const { x, y } = pointPosition(point, motion, width, height);
  return { x, y, luminance: sampleLuminance(x, y, motion, pointer) * pointVisibility(x, y, width, height) };
}

export const GLYPH_MAX_DELAY_SECONDS = 0.42;
export const GLYPH_FADE_SECONDS = 0.36;

/** The empty target is a dot. Glyph mixtures live in two fixed-size shared atlases,
 * not a growing list of historical targets. Times use the paused field clock. */
export interface GlyphTransition {
  target: string;
  startsAt: number;
  fromDotWeight: number;
}

const finiteTime = (seconds: number) => Number.isFinite(seconds) ? seconds : 0;

export function luminanceDelay(luminance: number): number {
  return (1 - clamp(Number.isFinite(luminance) ? luminance : 0)) * GLYPH_MAX_DELAY_SECONDS;
}

export function createGlyphTransition(target = '', seconds = 0): GlyphTransition {
  return {
    target,
    startsAt: finiteTime(seconds) - GLYPH_FADE_SECONDS,
    fromDotWeight: target ? 0 : 1,
  };
}

export function transitionProgress(transition: GlyphTransition, seconds: number): number {
  return smoothstep(0, GLYPH_FADE_SECONDS, finiteTime(seconds) - transition.startsAt);
}

export function transitionDotWeight(transition: GlyphTransition, progress: number): number {
  return transition.fromDotWeight * (1 - progress) + (transition.target ? 0 : progress);
}

/** Call only on a real target change, after capturing the current glyph pixels.
 * A newer target replaces the old deadline; the captured appearance stays put
 * during its delay. Moving luminance must never reschedule that deadline. */
export function retargetGlyphTransition(
  transition: GlyphTransition, target: string, luminance: number, seconds: number,
): boolean {
  if (target === transition.target) return false;
  const now = finiteTime(seconds);
  transition.fromDotWeight = transitionDotWeight(transition, transitionProgress(transition, now));
  transition.target = target;
  transition.startsAt = now + luminanceDelay(luminance);
  return true;
}

export interface Grapheme {
  segment: string;
  index: number;
}

/** UTF-16 offsets are suitable for Range, including combining and ZWJ sequences. */
export function segmentGraphemes(text: string, useIntl = true): Grapheme[] {
  if (useIntl && typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
      ({ segment, index }) => ({ segment, index }));
  }

  // Conservative fallback for older engines: do not split marks, emoji modifiers,
  // variation selectors, ZWJ emoji or paired regional indicators into fragments.
  const result: Grapheme[] = [];
  let index = 0;
  let regionalRun = 0;
  for (const point of text) {
    const previous = result.at(-1);
    const regional = /[\u{1f1e6}-\u{1f1ff}]/u.test(point);
    const extending = /[\p{Mark}\uFE0E\uFE0F\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]/u.test(point);
    if (previous && (extending || point === '\u200d' || previous.segment.endsWith('\u200d')
      || (regional && regionalRun % 2 === 1) || (point === '\n' && previous.segment === '\r'))) {
      previous.segment += point;
    } else {
      result.push({ segment: point, index });
    }
    regionalRun = regional ? regionalRun + 1 : 0;
    index += point.length;
  }
  return result;
}
