import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createGlyphTransition, GLYPH_ATLAS_MAX_BYTES, GLYPH_ATLAS_TILE_SIZE, GLYPH_FADE_SECONDS,
  GLYPH_MAX_DELAY_SECONDS, glyphAtlasLayout, luminanceDelay, makeGrid, POINT_BUDGET,
  retargetGlyphTransition, sampleLuminance, segmentGraphemes, transitionDotWeight, transitionProgress,
} from '../src/lib/glyph-field.ts';

test('fixed grid stays within the point budget at desktop, mobile and 4K sizes', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [3840, 2160], [100000, 1], [1, 100000], [1, 1]]) {
    const points = makeGrid(width, height);
    assert.ok(points.length > 0 && points.length <= POINT_BUDGET);
    assert.deepEqual(points, makeGrid(width, height));
    assert.ok(points.every(({ x, y }) => x > 0 && x < width && y > 0 && y < height));
  }
});

test('one luminance field retains empty, intermediate and fully white samples on desktop and portrait', () => {
  const pointer = { x: 0, y: 0, active: false };
  for (const [width, height] of [[1440, 900], [390, 844], [320, 740]]) {
    const samples = makeGrid(width, height).map(({ x, y }) => sampleLuminance(x, y, 0, pointer));
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
    const points = makeGrid(width, height);
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
  for (const [width, height, count] of [[1440, 900, 2560], [390, 844, 646], [320, 740, 462]]) {
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
    const points = makeGrid(width, height);
    assert.equal(points.length, count, 'point spacing and the existing budget are unchanged');
  }
});

test('pointer light contributes to the same field and falls off with distance', () => {
  const off = { x: 1000, y: 300, active: false };
  const on = { ...off, active: true };
  assert.ok(sampleLuminance(1000, 300, 0, on) > sampleLuminance(1000, 300, 0, off));
  assert.ok(Math.abs(sampleLuminance(0, 0, 0, on) - sampleLuminance(0, 0, 0, off)) < 0.00001);
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
  const point = makeGrid(1440, 900).find(({ x, y }) => {
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
    const grid = makeGrid(width, height);
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
