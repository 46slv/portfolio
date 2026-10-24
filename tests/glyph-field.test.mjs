import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createGlyphTransition, GLYPH_ATLAS_MAX_BYTES, GLYPH_ATLAS_TILE_SIZE, GLYPH_FADE_SECONDS,
  GLYPH_MAX_DELAY_SECONDS, glyphAtlasLayout, luminanceDelay, makePoints, POINT_BUDGET,
  retargetGlyphTransition, sampleLuminance, segmentGraphemes, transitionDotWeight, transitionProgress,
  advanceFieldMotion, createFieldMotion, FIELD_PADDING, EDGE_FADE, POINT_VELOCITY,
  GRADIENT_VELOCITY, pointPosition, pointVisibility, samplePoint, POINT_SPEED_FACTORS,
  densityVisibility, advancePointPresence, POINT_PRESENCE_SECONDS,
} from '../src/lib/glyph-field.ts';

test('stable anchors stay within the point budget at desktop, mobile and 4K sizes', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [3840, 2160], [100000, 1], [1, 100000], [1, 1]]) {
    const points = makePoints(width, height);
    assert.ok(points.length > 0 && points.length <= POINT_BUDGET);
    assert.deepEqual(points, makePoints(width, height));
    assert.ok(points.every(({ x, y }) => x > -FIELD_PADDING && x < width + FIELD_PADDING && y > -FIELD_PADDING && y < height + FIELD_PADDING));
  }
});

test('points translate diagonally for an hour without reversing or returning to their anchors', () => {
  const [width, height] = [10000, 10000];
  const point = makePoints(width, height).find(({ x, y }) => x > 100 && x < 2000 && y > 100 && y < 2000);
  assert.ok(point);
  const speed = POINT_SPEED_FACTORS[point.speedIndex];
  const original = structuredClone(point);
  const motion = createFieldMotion();
  const start = pointPosition(point, motion, width, height);
  let previous = start;
  let elapsed = 0;
  for (const seconds of [1, 10, 30, 180, 600, 1800, 3600]) {
    advanceFieldMotion(motion, seconds - elapsed, width, height);
    const current = pointPosition(point, motion, width, height);
    assert.ok(current.x > previous.x && current.y > previous.y, 'both axes keep their direction away from wraps');
    assert.ok(Math.abs(current.x - start.x - seconds * POINT_VELOCITY.x * speed) < 1e-8);
    assert.ok(Math.abs(current.y - start.y - seconds * POINT_VELOCITY.y * speed) < 1e-8);
    previous = current;
    elapsed = seconds;
  }
  assert.deepEqual(point, original, 'anchors never accumulate displacement');
});

test('padded wrapping is invisible, smooth at the viewport edge and preserves density', () => {
  const off = { x: 0, y: 0, active: false };
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const grid = makePoints(width, height);

    const counts = [];
    for (let seconds = 0; seconds <= 2000; seconds += 25) {
      const motion = createFieldMotion();
      advanceFieldMotion(motion, seconds, width, height);
      const positions = grid.map((point) => samplePoint(point, motion, width, height, off));
      counts.push(positions.filter(({ x, y }) => x > 0 && x < width && y > 0 && y < height).length);
      assert.equal(new Set(positions.map(({ x, y }) => `${x.toFixed(6)},${y.toFixed(6)}`)).size, grid.length);
      assert.ok(positions.every(({ x, y, luminance }) => x >= -FIELD_PADDING && x < width + FIELD_PADDING
        && y >= -FIELD_PADDING && y < height + FIELD_PADDING && luminance >= 0 && luminance <= 1));
    }
    assert.ok(Math.max(...counts) - Math.min(...counts) < grid.length * 0.18,
      'seeded population retains bounded geometric density through independent-speed recycling');
    for (const axis of ['x', 'y']) {
      const size = axis === 'x' ? width : height;
      const point = grid.reduce((best, next) => next[axis] > best[axis] ? next : best);
      const untilWrap = (size + FIELD_PADDING - point[axis]) / (POINT_VELOCITY[axis] * POINT_SPEED_FACTORS[point.speedIndex]);
      const motion = createFieldMotion();
      advanceFieldMotion(motion, untilWrap - 1 / 60, width, height);
      const before = samplePoint(point, motion, width, height, off);
      advanceFieldMotion(motion, 1 / 30, width, height);
      const after = samplePoint(point, motion, width, height, off);
      assert.equal(before.luminance, 0);
      assert.equal(after.luminance, 0, 'a recycled dot/glyph is fully invisible in the padded seam');
      assert.ok(before[axis] > size && after[axis] < 0);
      assert.ok(Math.abs(after[axis] + size + 2 * FIELD_PADDING - before[axis]
        - POINT_VELOCITY[axis] * POINT_SPEED_FACTORS[point.speedIndex] / 30) < 1e-9);
    }
    assert.equal(pointVisibility(0, height / 2, width, height), 0);
    assert.equal(pointVisibility(EDGE_FADE, height / 2, width, height), 1);
    assert.equal(pointVisibility(width, height / 2, width, height), 0);
    assert.ok(pointVisibility(0.001, height / 2, width, height) < 1e-7);
    assert.ok(pointVisibility(EDGE_FADE / 2, height / 2, width, height) > 0);
  }
});

test('translation offsets and wave phases stay bounded through long use and resize', () => {
  const motion = createFieldMotion();
  for (let step = 0; step < 50000; step++) advanceFieldMotion(motion, 0.1, 390, 844);
  POINT_SPEED_FACTORS.forEach((factor, index) => {
    assert.ok(Math.abs(motion.offsetX[index] - (5000 * POINT_VELOCITY.x * factor % (390 + 2 * FIELD_PADDING))) < 1e-7);
    assert.ok(Math.abs(motion.offsetY[index] - (5000 * POINT_VELOCITY.y * factor % (844 + 2 * FIELD_PADDING))) < 1e-7);
  });
  const off = { x: 0, y: 0, active: false };
  for (const [x, y] of [[40, 600], [300, 300], [800, 500]]) {
    assert.ok(Math.abs(sampleLuminance(x, y, motion, off) - sampleLuminance(x, y, 5000, off)) < 1e-8,
      'many short frame steps agree with the analytic long-time field');
  }
  for (const [width, height] of [[390, 844], [1440, 900], [1, 1], [1, 100000], [100000, 1]]) {
    const phaseBefore = [...motion.evolution, ...motion.translation];
    advanceFieldMotion(motion, 0, width, height);
    assert.deepEqual([...motion.evolution, ...motion.translation], phaseBefore, 'resize preserves field phase');
    assert.ok(motion.offsetX.every((value) => value >= 0 && value < width + 2 * FIELD_PADDING));
    assert.ok(motion.offsetY.every((value) => value >= 0 && value < height + 2 * FIELD_PADDING));
    assert.ok(makePoints(width, height).length <= POINT_BUDGET);
    advanceFieldMotion(motion, 30 * 24 * 3600, width, height);
    assert.ok([...motion.evolution, ...motion.translation].every((phase) => Number.isFinite(phase) && phase >= 0 && phase < Math.PI * 2));
    assert.ok(motion.offsetX.every((value) => value >= 0 && value < width + 2 * FIELD_PADDING));
    assert.ok(motion.offsetY.every((value) => value >= 0 && value < height + 2 * FIELD_PADDING));
  }
});

test('gradient advection translates diagonally while the original color evolution stays live', () => {
  const off = { x: 0, y: 0, active: false };
  for (const seconds of [1, 30, 600, 3600]) {
    const motion = createFieldMotion();
    advanceFieldMotion(motion, seconds, 390, 844);
    const evolving = { ...motion, translation: [0, 0, 0] };
    const translating = { ...motion, evolution: [0, 0, 0] };
    [0.78, -0.54, 0.42].forEach((rate, index) => {
      assert.ok(Math.abs(Math.sin(motion.evolution[index]) - Math.sin(rate * seconds)) < 1e-11);
    });
    for (const [x, y] of [[25, 35], [340, 390], [800, 300]]) {
      const dx = GRADIENT_VELOCITY.x * seconds;
      const dy = GRADIENT_VELOCITY.y * seconds;
      assert.ok(Math.abs(sampleLuminance(x, y, motion, off)
        - sampleLuminance(x - dx, y - dy, evolving, off)) < 1e-11,
      'same evolving field sampled at the inverse common displacement');
      assert.ok(Math.abs(sampleLuminance(x + dx, y + dy, translating, off)
        - sampleLuminance(x, y, createFieldMotion(), off)) < 1e-11,
      'a gradient feature follows the chosen diagonal velocity when evolution is held fixed');
      assert.ok(Math.abs(sampleLuminance(x, y, motion, off) - sampleLuminance(x, y, seconds, off)) < 1e-11);
    }
  }
});

test('gradient phase wraps stay continuous and pointer light stays in screen space', () => {
  const off = { x: 0, y: 0, active: false };
  const rates = [0.78, -0.54, 0.42,
    -2.6 * (2.4 / 285 + 1.6 / 410), -2.6 * (1.6 / 240 - 2.4 / 610), -2.6 * (2.4 / 510 - 1.6 / 330)];
  for (const rate of rates) {
    const motion = createFieldMotion();
    advanceFieldMotion(motion, Math.PI * 2 / Math.abs(rate) - 0.001, 390, 844);
    const points = makePoints(390, 844).filter((_, index) => index % 37 === 0);
    const before = points.map(({ x, y }) => sampleLuminance(x, y, motion, off));
    advanceFieldMotion(motion, 0.002, 390, 844);
    assert.ok(points.every(({ x, y }, index) => Math.abs(sampleLuminance(x, y, motion, off) - before[index]) < 0.003),
      'each evolution/advection phase wraps independently without resetting the combined field');
  }
  for (const seconds of [0, 10, 120]) {
    const state = createFieldMotion();
    advanceFieldMotion(state, seconds, 1440, 900);
    const point = makePoints(1440, 900).find(({ x, y }) => sampleLuminance(x, y, state, off) < 0.2);
    assert.ok(point);
    const on = { ...point, active: true };
    assert.ok(sampleLuminance(point.x, point.y, state, on) > sampleLuminance(point.x, point.y, state, off) + 0.5);
    assert.ok(Math.abs(sampleLuminance(point.x + 1000, point.y, state, on)
      - sampleLuminance(point.x + 1000, point.y, state, off)) < 0.0003);
  }
});

test('visible samples use moving positions, the current gradient and the same edge fade', () => {
  const off = { x: 0, y: 0, active: false };
  const motion = createFieldMotion();
  advanceFieldMotion(motion, 160, 390, 844);
  let differsFromAnchor = 0;
  for (const point of makePoints(390, 844)) {
    const sample = samplePoint(point, motion, 390, 844, off);
    const field = sampleLuminance(sample.x, sample.y, motion, off);
    const expected = field * pointVisibility(sample.x, sample.y, 390, 844) * densityVisibility(field, point.densityRank);
    assert.equal(sample.luminance, expected);
    if (Math.abs(expected - sampleLuminance(point.x, point.y, motion, off)) > 0.2) differsFromAnchor++;
  }
  assert.ok(differsFromAnchor > 100, 'stale grid-anchor sampling would miss the rendered background');
});

test('star seeds create irregular positions and stable IDs, density ranks and speeds across resize', () => {
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('drawing must never re-roll stars'); };
  try {
    const large = makePoints(1440, 900);
    const small = makePoints(390, 844);
    assert.deepEqual(small, makePoints(390, 844));
    assert.equal(new Set(large.map(({ seed }) => seed)).size, large.length);
    assert.equal(new Set(large.map(({ x }) => x)).size, large.length, 'no repeated grid columns');
    assert.equal(new Set(large.map(({ y }) => y)).size, large.length, 'no repeated grid rows');
    for (const point of small) {
      const previous = large[point.id];
      assert.deepEqual([point.seed, point.speedIndex, point.densityRank], [previous.seed, previous.speedIndex, previous.densityRank]);
      assert.ok(Math.abs((point.x + FIELD_PADDING) / (390 + 2 * FIELD_PADDING)
        - (previous.x + FIELD_PADDING) / (1440 + 2 * FIELD_PADDING)) < 1e-12);
    }
    const bins = Array(64).fill(0);
    for (const { x, y } of large) bins[Math.min(7, Math.floor((y + FIELD_PADDING) / 964 * 8)) * 8
      + Math.min(7, Math.floor((x + FIELD_PADDING) / 1504 * 8))]++;
    const mean = large.length / bins.length;
    const fano = bins.reduce((sum, count) => sum + (count - mean) ** 2, 0) / bins.length / mean;
    assert.ok(fano > 0.5 && fano < 2, 'star-like local sparse/dense patches, without a dominant clump');
    const motion = createFieldMotion();
    advanceFieldMotion(motion, 123, 390, 844);
    assert.ok(small.every((point) => Number.isFinite(samplePoint(point, motion, 390, 844, { x: 0, y: 0, active: false }).luminance)));
  } finally { Math.random = originalRandom; }
});

test('brighter gradient states contain more stars with deterministic smooth threshold fades', () => {
  const points = makePoints(1440, 900);
  let previousCount = 0;
  for (const light of [0.1, 0.3, 0.6, 0.9]) {
    const count = points.filter(({ densityRank }) => densityVisibility(light, densityRank) >= 0.5).length;
    assert.ok(count > previousCount);
    assert.ok(Math.abs(count / points.length - (0.16 + 0.82 * light)) < 0.04);
    previousCount = count;
  }
  for (const { densityRank } of points.filter((_, index) => index % 11 === 0)) {
    let previous = densityVisibility(0, densityRank);
    for (let step = 1; step <= 50; step++) {
      const value = densityVisibility(step / 50, densityRank);
      assert.ok(value >= previous && value - previous < 0.08, 'no binary threshold pop or frame-wise random flicker');
      assert.equal(value, densityVisibility(step / 50, densityRank));
      previous = value;
    }
  }
});

test('seeded speed differences remain modest and every star keeps moving diagonally', () => {
  const points = makePoints(100000, 100000);
  const motion = createFieldMotion();
  advanceFieldMotion(motion, 10, 100000, 100000);
  assert.equal(new Set(points.map(({ speedIndex }) => speedIndex)).size, POINT_SPEED_FACTORS.length);
  assert.ok(Math.min(...POINT_SPEED_FACTORS) >= 0.8 && Math.max(...POINT_SPEED_FACTORS) <= 1.2);
  for (const point of points.filter(({ x, y }) => x > 1000 && y > 1000 && x < 90000 && y < 90000)) {
    const position = pointPosition(point, motion, 100000, 100000);
    const factor = POINT_SPEED_FACTORS[point.speedIndex];
    assert.ok(Math.abs(position.x - point.x - 10 * POINT_VELOCITY.x * factor) < 1e-8);
    assert.ok(Math.abs(position.y - point.y - 10 * POINT_VELOCITY.y * factor) < 1e-8);
  }
});

test('resize preserves normalized star locations and phases without reseeding or a restart', () => {
  const motion = createFieldMotion();
  advanceFieldMotion(motion, 123, 390, 844);
  const original = makePoints(390, 844);
  const positions = original.map((point) => pointPosition(point, motion, 390, 844));
  const phases = [...motion.evolution, ...motion.translation];
  advanceFieldMotion(motion, 0, 1440, 900);
  const enlarged = makePoints(1440, 900);
  for (const point of original) {
    const after = pointPosition(enlarged[point.id], motion, 1440, 900);
    assert.ok(Math.abs((after.x + FIELD_PADDING) / 1504 - (positions[point.id].x + FIELD_PADDING) / 454) < 1e-12);
    assert.ok(Math.abs((after.y + FIELD_PADDING) / 964 - (positions[point.id].y + FIELD_PADDING) / 908) < 1e-12);
  }
  advanceFieldMotion(motion, 0, 390, 844);
  for (const point of original) {
    const after = pointPosition(point, motion, 390, 844);
    assert.ok(Math.abs(after.x - positions[point.id].x) < 1e-9 && Math.abs(after.y - positions[point.id].y) < 1e-9);
  }
  assert.deepEqual([...motion.evolution, ...motion.translation], phases);
});

test('bounded resize population changes fade smoothly and pause without changing brightness mapping', () => {
  const motion = createFieldMotion();
  const off = { x: 0, y: 0, active: false };
  const point = makePoints(390, 844).find((point) => samplePoint(point, motion, 390, 844, off).luminance > 0.2);
  assert.ok(point);
  const full = samplePoint(point, motion, 390, 844, off);
  point.presence = 0;
  let previous = 0;
  for (let step = 1; step <= 10; step++) {
    advancePointPresence(point, true, POINT_PRESENCE_SECONDS / 10);
    const sample = samplePoint(point, motion, 390, 844, off);
    assert.equal(sample.brightness, full.brightness);
    assert.ok(sample.luminance >= previous && sample.luminance <= full.luminance + 1e-12);
    const frozen = sample.luminance;
    advancePointPresence(point, true, 0);
    assert.equal(samplePoint(point, motion, 390, 844, off).luminance, frozen);
    previous = sample.luminance;
  }
  for (let step = 0; step < 11; step++) advancePointPresence(point, false, POINT_PRESENCE_SECONDS / 10);
  assert.equal(point.presence, 0);
  assert.equal(samplePoint(point, motion, 390, 844, off).luminance, 0);
  assert.equal(makePoints(390, 844, POINT_BUDGET * 2).length, POINT_BUDGET);
});

test('one luminance field retains empty, intermediate and fully white samples on desktop and portrait', () => {
  const pointer = { x: 0, y: 0, active: false };
  for (const [width, height] of [[1440, 900], [390, 844], [320, 740]]) {
    const samples = makePoints(width, height).map(({ x, y }) => sampleLuminance(x, y, 0, pointer));
    assert.equal(Math.min(...samples), 0);
    assert.equal(Math.max(...samples), 1);
    assert.ok(samples.filter((value) => value === 0).length > samples.length * 0.1);
    assert.ok(samples.filter((value) => value === 1).length > samples.length * 0.05);
    assert.ok(samples.some((value) => value > 0.1 && value < 0.9));
  }
});

test('pointer-free waves visibly flow within 1–2 seconds but stay smooth frame to frame', () => {
  const pointer = { x: 0, y: 0, active: false };
  for (const [width, height] of [[1440, 900], [390, 844], [320, 740]]) {
    const points = makePoints(width, height);
    // Multiple phases prevent passing only because of a lucky initial frame.
    for (const seconds of [0, 2, 5, 10, 20, 30]) {
      const samples = points.map(({ x, y }) => sampleLuminance(x, y, seconds, pointer));
      const differences = (elapsed) => points.map(({ x, y }, index) => {
        const later = sampleLuminance(x, y, seconds + elapsed, pointer);
        assert.ok(Number.isFinite(later) && later >= 0 && later <= 1);
        return Math.abs(samples[index] - later);
      });
      const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const afterOneSecond = differences(1);
      assert.ok(mean(afterOneSecond) > 0.08, 'reject static or imperceptibly slow fields');
      assert.ok(afterOneSecond.filter((value) => value > 0.12).length > points.length * 0.2);
      assert.ok(mean(differences(2)) > 0.18, 'flow is appreciable without waiting many seconds');
      // This is a brightness-change bound, not an exact frame/deadline assertion.
      assert.ok(Math.max(...differences(1 / 30)) < 0.04, 'smooth motion, not temporal noise');
    }
  }
});

test('portrait and desktop contain finer spatial variation without a denser point grid', () => {
  const pointer = { x: 0, y: 0, active: false };
  for (const [width, height, count] of [[1440, 900, 2600], [390, 844, 851], [320, 740, 637]]) {
    for (const seconds of [0, 2, 5, 10, 20, 30]) {
      // Mean vertical total variation at three independent cross-sections. A
      // broad, nearly single-lobe portrait field cannot meet this lower bound.
      let variation = 0;
      for (const x of [width * 0.2, width * 0.5, width * 0.8]) {
        for (let y = 22; y < height; y += 22) {
          variation += Math.abs(sampleLuminance(x, y, seconds, pointer)
            - sampleLuminance(x, y - 22, seconds, pointer));
        }
      }
      assert.ok(variation / 3 > 1.3, 'multiple light/dark lobes fit inside the viewport');
    }
    const points = makePoints(width, height);
    assert.equal(points.length, count, 'padded grid density stays stable with no extra points during recycling');
  }
});

test('pointer light contributes to the same field and falls off with distance', () => {
  const off = { x: 1000, y: 300, active: false };
  const on = { ...off, active: true };
  assert.ok(sampleLuminance(1000, 300, 0, on) > sampleLuminance(1000, 300, 0, off));
  const tail = sampleLuminance(0, 0, 0, on) - sampleLuminance(0, 0, 0, off);
  assert.ok(tail > 0 && tail < 0.0003, 'the broad shoulder decays without a finite cutoff');
});

test('bright points change before dark points, with a bounded smooth fade', () => {
  const states = [1, 0.5, 0].map((luminance) => {
    const state = createGlyphTransition();
    retargetGlyphTransition(state, 'A', luminance, 0);
    return state;
  });
  assert.deepEqual(states.map(({ startsAt }) => startsAt), [0, 0.21, 0.42]);
  assert.ok(transitionProgress(states[0], 0.15) > 0);
  assert.equal(transitionProgress(states[1], 0.15), 0);
  assert.equal(transitionProgress(states[2], 0.15), 0);
  assert.ok(transitionProgress(states[0], 0.3) > transitionProgress(states[1], 0.3));
  assert.equal(transitionProgress(states[2], 0.3), 0);
  for (const state of states) {
    assert.equal(transitionProgress(state, state.startsAt), 0);
    assert.ok(Math.abs(transitionProgress(state, state.startsAt + GLYPH_FADE_SECONDS / 2) - 0.5) < 1e-12);
    assert.equal(transitionProgress(state, state.startsAt + GLYPH_FADE_SECONDS + 1e-6), 1);
    assert.ok(transitionProgress(state, state.startsAt + 0.001) < 0.001);
  }
  assert.equal(luminanceDelay(-1), GLYPH_MAX_DELAY_SECONDS);
  assert.equal(luminanceDelay(2), 0);
});

test('moving field and repeated hits cannot reschedule a captured luminance delay', () => {
  const pointer = { x: 0, y: 0, active: false };
  const point = makePoints(1440, 900).find(({ x, y }) => {
    const light = sampleLuminance(x, y, 0, pointer);
    return light > 0.2 && light < 0.8;
  });
  const first = sampleLuminance(point.x, point.y, 0, pointer);
  const later = sampleLuminance(point.x, point.y, 10, pointer);
  assert.notEqual(first, later);
  const state = createGlyphTransition();
  retargetGlyphTransition(state, '藤', first, 0);
  const deadline = state.startsAt;
  assert.equal(retargetGlyphTransition(state, '藤', later, 0.1), false);
  assert.equal(state.startsAt, deadline);
  assert.equal(deadline, luminanceDelay(first));
  assert.equal(transitionProgress(state, 10), 1);
});

// Reference mixing of image channels. The renderer flattens this mixture into a
// fixed atlas cell at each interruption; it does not retain these test maps.
const mix = (source, target, progress) => {
  const result = new Map(Array.from(source, ([glyph, weight]) => [glyph, weight * (1 - progress)]));
  result.set(target, (result.get(target) ?? 0) + progress);
  return new Map(Array.from(result).filter(([, weight]) => weight > 0));
};

test('halfway interruption holds exactly the current blend, then fades toward the newest target', () => {
  const state = createGlyphTransition();
  retargetGlyphTransition(state, 'A', 1, 0);
  const halfway = GLYPH_FADE_SECONDS / 2;
  const captured = mix(new Map([['', 1]]), state.target, transitionProgress(state, halfway));
  assert.deepEqual(Array.from(captured), [['', 0.5], ['A', 0.5]]);
  retargetGlyphTransition(state, 'B', 0.5, halfway);
  assert.deepEqual(mix(captured, state.target, transitionProgress(state, halfway)), captured);
  assert.deepEqual(mix(captured, state.target, transitionProgress(state, state.startsAt - 0.001)), captured);
  assert.equal(transitionDotWeight(state, 0), 0.5);
  const resumed = mix(captured, state.target, transitionProgress(state, state.startsAt + halfway));
  for (const [glyph, expected] of [['', 0.25], ['A', 0.25], ['B', 0.5]]) {
    assert.ok(Math.abs(resumed.get(glyph) - expected) < 1e-12);
  }
  assert.equal(transitionDotWeight(state, 0.5), 0.25);
});

test('new targets cancel unseen pending glyphs, including Japanese and return-to-dot', () => {
  const state = createGlyphTransition();
  let captured = new Map([['', 1]]);
  const change = (target, light, now) => {
    captured = mix(captured, state.target, transitionProgress(state, now));
    retargetGlyphTransition(state, target, light, now);
  };
  change('A', 0, 0);
  change('B', 1, 0.1);
  assert.equal(captured.has('A'), false);
  change('藤', 0, 0.2);
  assert.ok(captured.has('B'));
  change('', 0.5, 0.25);
  assert.equal(captured.has('A'), false);
  assert.equal(captured.has('藤'), false);
  assert.equal(state.target, '');
  const finalProgress = transitionProgress(state, 2);
  assert.equal(finalProgress, 1);
  assert.equal(transitionDotWeight(state, finalProgress), 1);
  assert.deepEqual(Array.from(mix(captured, state.target, finalProgress)), [['', 1]]);
});

test('rapid alternation keeps fixed transition state, finite weights and exact settled endpoints', () => {
  const state = createGlyphTransition();
  const keys = Object.keys(state);
  for (let i = 0; i < 10000; i++) {
    const now = i / 1000;
    retargetGlyphTransition(state, ['A', 'B', '藤', ''][i % 4], (i % 101) / 100, now);
    const progress = transitionProgress(state, now + 0.03);
    const dot = transitionDotWeight(state, progress);
    assert.ok(Number.isFinite(progress) && progress >= 0 && progress <= 1);
    assert.ok(Number.isFinite(dot) && dot >= 0 && dot <= 1);
    assert.deepEqual(Object.keys(state), keys);
  }
  retargetGlyphTransition(state, '', 0, 20);
  assert.equal(transitionDotWeight(state, transitionProgress(state, 21)), 1);
  for (const time of [0, 1e-9, 10, 10000, 1e8, NaN, Infinity]) {
    const fresh = createGlyphTransition('', time);
    retargetGlyphTransition(fresh, '終', NaN, time);
    assert.ok(Number.isFinite(fresh.startsAt));
    assert.ok(Number.isFinite(transitionProgress(fresh, time)));
    assert.ok(Number.isFinite(luminanceDelay(time)));
  }
});

test('atlas sizing and repeated resize/target changes stay inside a fixed two-buffer budget', () => {
  assert.equal(GLYPH_ATLAS_TILE_SIZE, 32);
  assert.equal(GLYPH_ATLAS_MAX_BYTES, 21307392);
  for (let count = 1; count <= POINT_BUDGET; count++) {
    const layout = glyphAtlasLayout(count);
    assert.ok(layout.bytes <= GLYPH_ATLAS_MAX_BYTES);
    assert.ok(layout.width * layout.height / GLYPH_ATLAS_TILE_SIZE ** 2 >= count);
  }
  for (let i = 0; i < 200; i++) {
    const [width, height] = [[390, 844], [3840, 2160], [1180, 757]][i % 3];
    const grid = makePoints(width, height);
    assert.ok(glyphAtlasLayout(grid.length).bytes <= GLYPH_ATLAS_MAX_BYTES);
    const target = ['A', '藤', ''][i % 3];
    // New points settle to only the latest target; old cell pixels/deadlines are
    // not part of the resize state. This checks math, not browser allocation/GC.
    for (const _point of grid) {
      const state = createGlyphTransition(target, i);
      assert.equal(transitionProgress(state, i + 1e-6), 1);
      assert.equal(transitionDotWeight(state, 1), target ? 0 : 1);
    }
  }
});

for (const useIntl of [true, false]) {
  test(`graphemes retain UTF-16 Range offsets (${useIntl ? 'Intl.Segmenter' : 'safe fallback'})`, () => {
    const text = 'A藤 g\u0301👩🏽‍💻🇯🇵か\u3099';
    const result = segmentGraphemes(text, useIntl);
    assert.deepEqual(result.map(({ segment }) => segment), ['A', '藤', ' ', 'g\u0301', '👩🏽‍💻', '🇯🇵', 'か\u3099']);
    assert.ok(result.every(({ segment, index }) => text.slice(index, index + segment.length) === segment));
  });
}
