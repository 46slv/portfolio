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
export const POINT_SPEED_FACTORS = Array.from({ length: 9 }, (_, index) => 0.84 + index * 0.04);
export const POINT_PRESENCE_SECONDS = 0.5;

export interface FieldPoint {
  id: number;
  seed: number;
  x: number;
  y: number;
  speedIndex: number;
  densityRank: number;
  presence: number;
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
  offsetX: number[];
  offsetY: number[];
  spanX: number;
  spanY: number;
  evolution: number[];
  translation: number[];
}

export function createFieldMotion(): FieldMotion {
  return {
    offsetX: POINT_SPEED_FACTORS.map(() => 0), offsetY: POINT_SPEED_FACTORS.map(() => 0),
    spanX: 0, spanY: 0, evolution: [0, 0, 0], translation: [0, 0, 0],
  };
}

/** Bounded shared offsets/phases, never an accumulating world coordinate.
 * Zero elapsed normalizes offsets after resize without restarting motion. */
export function advanceFieldMotion(motion: FieldMotion, elapsed: number, width: number, height: number): void {
  const delta = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const spanX = width + 2 * FIELD_PADDING;
  const spanY = height + 2 * FIELD_PADDING;
  for (let index = 0; index < POINT_SPEED_FACTORS.length; index++) {
    // Preserve normalized locations through a resize, including a resize back.
    if (motion.spanX && motion.spanX !== spanX) motion.offsetX[index] *= spanX / motion.spanX;
    if (motion.spanY && motion.spanY !== spanY) motion.offsetY[index] *= spanY / motion.spanY;
    motion.offsetX[index] = advanceCycle(motion.offsetX[index], POINT_VELOCITY.x * POINT_SPEED_FACTORS[index], delta, spanX);
    motion.offsetY[index] = advanceCycle(motion.offsetY[index], POINT_VELOCITY.y * POINT_SPEED_FACTORS[index], delta, spanY);
  }
  motion.spanX = spanX;
  motion.spanY = spanY;
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

/** Fixed screen samples exclude pointer glow, density, presence and the point
 * pool itself, so adding stars cannot feed back into the global brightness. */
export const GLOBAL_SAMPLE_COLUMNS = 16;
export const GLOBAL_SAMPLE_ROWS = 12;
export const GLOBAL_POPULATION_FLOOR = 0.55;
export const GLOBAL_POPULATION_RESPONSE_SECONDS = 1.8;
export const GLOBAL_POPULATION_RATE = 0.06;
const populationPointer: FieldPointer = { x: 0, y: 0, active: false };

export function sampleGlobalLuminance(width: number, height: number, motion: FieldMotion): number {
  let light = 0;
  for (let row = 0; row < GLOBAL_SAMPLE_ROWS; row++) {
    for (let column = 0; column < GLOBAL_SAMPLE_COLUMNS; column++) {
      light += sampleLuminance((column + 0.5) * width / GLOBAL_SAMPLE_COLUMNS,
        (row + 0.5) * height / GLOBAL_SAMPLE_ROWS, motion, populationPointer);
    }
  }
  return light / (GLOBAL_SAMPLE_COLUMNS * GLOBAL_SAMPLE_ROWS);
}

export interface GlobalPopulation {
  capacity: number;
  light: number;
  count: number;
}
const populationCapacity = (capacity: number) => Math.max(1,
  Math.min(POINT_BUDGET, Math.floor(Number.isFinite(capacity) ? capacity : 1)));
const populationLight = (light: number) => clamp(Number.isFinite(light) ? light : 0);
const populationTarget = (capacity: number, light: number) =>
  capacity * (GLOBAL_POPULATION_FLOOR + (1 - GLOBAL_POPULATION_FLOOR) * light);

export function createGlobalPopulation(capacity: number, light: number): GlobalPopulation {
  const limit = populationCapacity(capacity);
  const value = populationLight(light);
  return { capacity: limit, light: value, count: Math.max(1, populationTarget(limit, value)) };
}

/** A paused-clock envelope with a 0.2% deadband and a 6%-of-capacity/s slew.
 * Count is continuous internally; prefix membership uses its rounded value. */
export function advanceGlobalPopulation(state: GlobalPopulation, light: number,
  elapsed: number, capacity = state.capacity): number {
  const limit = populationCapacity(capacity);
  if (limit !== state.capacity) state.count *= limit / state.capacity;
  state.capacity = limit;
  const delta = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  if (delta > 0) {
    state.light += (populationLight(light) - state.light)
      * (1 - Math.exp(-delta / GLOBAL_POPULATION_RESPONSE_SECONDS));
    const difference = populationTarget(limit, state.light) - state.count;
    if (Math.abs(difference) > Math.max(1, limit * 0.002)) {
      const step = limit * GLOBAL_POPULATION_RATE * delta;
      state.count += Math.max(-step, Math.min(step, difference));
    }
  }
  state.count = Math.max(1, Math.min(limit, state.count));
  return Math.round(state.count);
}

/** Stable independent hash streams: randomness is assigned once per ID, never
 * generated during drawing. The same ID keeps its seed, speed and density rank. */
const seededUnit = (id: number, salt: number) => {
  let value = (id ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

export function pointCount(width: number, height: number): number {
  return Math.max(1, Math.min(POINT_BUDGET, Math.floor((width + 2 * FIELD_PADDING) * (height + 2 * FIELD_PADDING) / 22 ** 2)));
}

/** A seeded, irregular pool in the padded field. Prefix IDs survive resize;
 * capacity permits a bounded retiring tail to fade out before release. */
export function makePoints(width: number, height: number, capacity = pointCount(width, height)): FieldPoint[] {
  const count = Math.max(1, Math.min(POINT_BUDGET, Math.floor(capacity)));
  return Array.from({ length: count }, (_, id) => ({
    id, seed: (id ^ 0xa511e9b3) >>> 0,
    x: -FIELD_PADDING + seededUnit(id, 0xa511e9b3) * (width + 2 * FIELD_PADDING),
    y: -FIELD_PADDING + seededUnit(id, 0x63d83595) * (height + 2 * FIELD_PADDING),
    speedIndex: Math.floor(seededUnit(id, 0xb5297a4d) * POINT_SPEED_FACTORS.length),
    densityRank: seededUnit(id, 0x68e31da4), presence: 1,
  }));
}

/** Increasing occupancy, separate from the existing brightness/size mapping.
 * The fixed rank and broad smooth band fade stars instead of re-rolling them. */
export function densityVisibility(luminance: number, rank: number): number {
  const occupancy = 0.12 + 0.78 * clamp(luminance);
  return smoothstep(rank - 0.16, rank + 0.16, occupancy);
}

export function advancePointPresence(point: FieldPoint, present: boolean, elapsed: number): void {
  point.presence = clamp(point.presence + (present ? 1 : -1) * Math.max(0, elapsed) / POINT_PRESENCE_SECONDS);
}

export function pointPosition(point: FieldPoint, motion: FieldMotion, width: number, height: number): { x: number; y: number } {
  return {
    x: wrap(point.x + FIELD_PADDING + motion.offsetX[point.speedIndex], width + 2 * FIELD_PADDING) - FIELD_PADDING,
    y: wrap(point.y + FIELD_PADDING + motion.offsetY[point.speedIndex], height + 2 * FIELD_PADDING) - FIELD_PADDING,
  };
}

export function pointVisibility(x: number, y: number, width: number, height: number): number {
  const fade = Math.min(EDGE_FADE, width / 4, height / 4);
  return fade > 0 ? smoothstep(0, fade, Math.min(x, y, width - x, height - y)) : 0;
}

/** One visible sample owns drawing, text readability and transition delays. */
export function samplePoint(point: FieldPoint, motion: FieldMotion, width: number, height: number, pointer: FieldPointer) {
  const { x, y } = pointPosition(point, motion, width, height);
  const fieldLight = sampleLuminance(x, y, motion, pointer);
  const brightness = fieldLight * pointVisibility(x, y, width, height);
  const density = densityVisibility(fieldLight, point.densityRank);
  return { x, y, brightness, density, luminance: brightness * density * smoothstep(0, 1, point.presence) };
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
