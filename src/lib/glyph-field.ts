/** Pure field and transition math, shared with the focused Node tests. */
export interface FieldPointer {
  x: number;
  y: number;
  active: boolean;
}

export const POINT_BUDGET = 2600;
export const MAX_DPR = 2;
export const GLYPH_ATLAS_TILE_SIZE = 32;
export const POINT_DRIFT_RADIUS = 4.5;

export interface FieldPoint {
  x: number;
  y: number;
  phase: number;
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

// Smaller lobes keep several light/dark regions visible even in portrait. The
// phase advances six times faster than the original 48–90s waves (now 8–15s),
// producing visible flow within 1–2s independently of the slower point drift, without temporal noise.
const FIELD_SPATIAL_SCALE = 2.6;
const FIELD_TIME_SCALE = 6;

/** Continuous grayscale waves; motion never depends on an active pointer. */
export function sampleLuminance(x: number, y: number, seconds: number, pointer: FieldPointer): number {
  const fieldX = x * FIELD_SPATIAL_SCALE;
  const fieldY = y * FIELD_SPATIAL_SCALE;
  const fieldTime = seconds * FIELD_TIME_SCALE;
  const field = 0.46
    + 0.30 * Math.sin(fieldX / 285 + fieldY / 410 + fieldTime * 0.13)
    + 0.23 * Math.cos(fieldY / 240 - fieldX / 610 - fieldTime * 0.09)
    + 0.17 * Math.sin(fieldX / 510 - fieldY / 330 + fieldTime * 0.07);
  const distanceSquared = (x - pointer.x) ** 2 + (y - pointer.y) ** 2;
  const pointerLight = pointer.active ? 0.82 * Math.exp(-distanceSquared / (2 * 105 ** 2)) : 0;
  // Explicit endpoints matter: some areas really are empty, others are white.
  return smoothstep(0.26, 0.87, field + pointerLight);
}

export function makeGrid(width: number, height: number): FieldPoint[] {
  const spacing = Math.max(22, Math.sqrt(width * height / POINT_BUDGET));
  const columns = Math.min(POINT_BUDGET, Math.max(1, Math.floor(width / spacing)));
  const rows = Math.min(Math.floor(POINT_BUDGET / columns), Math.max(1, Math.floor(height / spacing)));
  return Array.from({ length: columns * rows }, (_, index) => ({
    x: (index % columns + 0.5) * width / columns,
    y: (Math.floor(index / columns) + 0.5) * height / rows,
    phase: index * 2.399963229728653 % (Math.PI * 2),
  }));
}

/** Continuous, bounded orbits around stable anchors. No wrap or random steps.
 * Reduced motion freezes the renderer's existing clock at its current time. */
export function pointPosition(point: FieldPoint, seconds: number): { x: number; y: number } {
  const radius = Math.min(POINT_DRIFT_RADIUS, point.x / 2, point.y / 2);
  return {
    x: point.x + radius * Math.sin(seconds * 0.065 + point.phase),
    y: point.y + radius * Math.cos(seconds * 0.053 + point.phase * 1.61803398875),
  };
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
