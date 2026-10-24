import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { advanceFieldMotion, createFieldMotion, GLYPH_ATLAS_MAX_BYTES, MAX_DPR, makePoints, samplePoint } from '../src/lib/glyph-field.ts';
import { clearCursorPointer, updateCursorPointer } from '../src/lib/cursor-pointer.ts';

// Run the real renderer against small DOM/Canvas doubles. This checks scheduling,
// lifecycle and resource ownership, not actual raster pixels or browser layout.
// Hold the new global envelope at full capacity in these legacy exact-alpha
// fixtures. global-population.test.mjs exercises real means and live ID changes.
const source = await readFile(new URL('../src/scripts/glyph-field.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace(/sampleGlobalLuminance\(width, height, fieldMotion\)/g, '1')
  .replace(/from '(\.\.\/lib\/[^']+)'/g,
  (_, path) => `from '${new URL(`${path}.ts`, new URL('../src/scripts/', import.meta.url)).href}'`);
const { mountGlyphField } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('renderer flows without a pointer on desktop/portrait and preserves buffers, targets and lifecycle', () => {
  const canvases = [];
  let drawCalls = 0;
  let expectedSamples = new Map();
  let expectedById = new Map();
  let resizeFrames = 100;
  const expectedMotion = createFieldMotion();
  let expectedLastTime = 0;
  let verifyIdleAlpha = true;
  const positionKey = (x, y) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
  class Canvas {
    width = 300;
    height = 150;
    dataset = {};
    dots = new Map();
    pointKey = '';
    positions = new Map();
    position = [0, 0];
    pen = {
      clearRect: () => {
        this.dots.clear();
        this.positions.clear();
        if (this === canvas) {
          const points = makePoints(window.innerWidth, window.innerHeight, Number(canvas.dataset.pointCount));
          expectedSamples = new Map();
          expectedById = new Map();
          for (const point of points) {
            const expected = samplePoint(point, expectedMotion, window.innerWidth, window.innerHeight,
              { x: 0, y: 0, active: false });
            expectedSamples.set(positionKey(expected.x, expected.y), { point, expected });
            expectedById.set(String(point.id), expected);
          }
        }
      },
      arc: (x, y) => {
        const record = expectedSamples.get(positionKey(x, y));
        assert.ok(record, 'a draw belongs to one stable seeded ID at its independently moving position');
        const { point, expected } = record;
        this.pointKey = String(point.id);
        assert.ok(Math.abs(x - expected.x) < 1e-8 && Math.abs(y - expected.y) < 1e-8,
          'production draw follows the known paused clock through independent-speed wraps');
        this.expectedLuminance = expected.luminance;
        this.position = [x, y];
      },
      fill: () => {
        if (verifyIdleAlpha && resizeFrames > 20) assert.ok(Math.abs(this.pen.globalAlpha - this.expectedLuminance) < 1e-10,
          'actual dot alpha samples the moving position, translated/evolving gradient and edge fade');
        this.dots.set(this.pointKey, this.pen.globalAlpha);
        this.positions.set(this.pointKey, this.position);
      },
      setTransform() {}, beginPath() {}, fillText() {}, fillRect() {},
      measureText() { return { width: 28 }; },
      drawImage: (image, ...args) => {
        if (this === canvas) {
          const [x, y, width, height] = args.slice(-4);
          this.pen.arc(x + width / 2, y + height / 2);
          this.positions.set(this.pointKey, this.position);
        }
        assert.ok(image.width > 0 && image.height > 0, 'never draw a released buffer');
        drawCalls++;
      },
    };
    constructor() { canvases.push(this); }
    getContext() { return this.pen; }
  }
  const motion = Object.assign(new EventTarget(), { matches: false });
  const callbacks = new Map();
  let frameId = 0;
  const window = Object.assign(new EventTarget(), {
    innerWidth: 1180, innerHeight: 757, devicePixelRatio: 4,
    matchMedia: () => motion,
    requestAnimationFrame(callback) { callbacks.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
  });
  let boundsReads = 0;
  const region = (initial = '', small = false) => {
    const values = new Map(initial ? [['--home-background-luminance', initial]] : []);
    return {
      style: {
        getPropertyValue: (key) => values.get(key) ?? '',
        setProperty: (key, value) => values.set(key, value),
        removeProperty: (key) => values.delete(key),
      },
      getBoundingClientRect() {
        boundsReads++;
        return small ? { left: 100, right: 124, top: 100, bottom: 124 }
          : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
      },
    };
  };
  const regions = [region('0.333'), region(), region('', true)];
  let hit = '';
  const sourceElement = { closest() { return this; } };
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    documentElement: new EventTarget(),
    querySelectorAll(selector) {
      assert.equal(selector, '[data-home-background] .home-readability');
      return regions;
    },
    createElement(name) { assert.equal(name, 'canvas'); return new Canvas(); },
    elementFromPoint() {
      hitTests++;
      return hit ? sourceElement : null;
    },
    createTreeWalker() {
      let visited = false;
      return { nextNode() { if (visited) return null; visited = true; return { textContent: hit }; } };
    },
    createRange() {
      return { setStart() {}, setEnd() {}, getClientRects: () => [{ left: 0, top: 0, right: 100, bottom: 100, width: 100 }] };
    },
  });
  const originals = new Map(['window', 'document', 'NodeFilter'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window, document, NodeFilter: { SHOW_TEXT: 4 } });
  clearCursorPointer();
  const canvas = new Canvas();
  let cleanup;
  let time = 0;
  let hitTests = 0;
  window.addEventListener('resize', () => {
    advanceFieldMotion(expectedMotion, 0, window.innerWidth, window.innerHeight);
    resizeFrames = 0;
  });
  window.addEventListener('pagehide', () => { expectedLastTime = 0; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) expectedLastTime = 0; });
  motion.addEventListener('change', () => { expectedLastTime = 0; });
  const frame = () => {
    const [id, callback] = callbacks.entries().next().value;
    callbacks.delete(id);
    time += 34;
    const elapsed = expectedLastTime ? Math.min((time - expectedLastTime) / 1000, 0.1) : 0;
    advanceFieldMotion(expectedMotion, elapsed, window.innerWidth, window.innerHeight);
    expectedLastTime = time;
    resizeFrames++;
    callback(time);
    if (verifyIdleAlpha && window.innerWidth >= 140 && window.innerHeight >= 140) {
      const local = [...canvas.positions].filter(([, [x, y]]) => x >= 84 && x <= 140 && y >= 84 && y <= 140)
        .map(([id]) => canvas.dots.get(id));
      assert.ok(Number(regions[2].style.getPropertyValue('--home-background-luminance')) + 0.003 >= Math.max(0, ...local),
        'every presented density/population fade is covered immediately by its local text palette');
    }
  };
  try {
    cleanup = mountGlyphField(canvas);
    const atlases = canvases.slice(1);
    assert.equal(atlases.length, 2);
    assert.equal(callbacks.size, 1);
    assert.equal(canvas.width, window.innerWidth * MAX_DPR);
    assert.equal(canvas.height, window.innerHeight * MAX_DPR);
    frame();
    // Exercise the actual RAF clock and canvas dot alphas with no mouse events.
    // A mobile field must animate independently of hover/pointer activation.
    for (const [width, height] of [[1180, 757], [390, 844]]) {
      [window.innerWidth, window.innerHeight] = [width, height];
      window.dispatchEvent(new Event('resize'));
      const initial = new Map(canvas.dots);
      const initialPositions = new Map(canvas.positions);
      const initialBoundsReads = boundsReads;
      const change = () => {
        const keys = new Set([...initial.keys(), ...canvas.dots.keys()]);
        const differences = Array.from(keys, (key) => Math.abs((initial.get(key) ?? 0) - (canvas.dots.get(key) ?? 0)));
        return {
          mean: differences.reduce((sum, value) => sum + value, 0) / Number(canvas.dataset.pointCount),
          changed: differences.filter((value) => value > 0.12).length / Number(canvas.dataset.pointCount),
        };
      };
      for (let i = 0; i < 30; i++) frame();
      assert.ok(change().mean > 0.08, 'rendered brightness visibly changes in about one second');
      const displacements = Array.from(canvas.positions, ([key, value]) => initialPositions.has(key)
        ? Math.hypot(value[0] - initialPositions.get(key)[0], value[1] - initialPositions.get(key)[1]) : null)
        .filter((value) => value !== null);
      assert.ok(displacements.length > 50);
      assert.ok(displacements.filter((value) => value > 0.04).length > displacements.length * 0.6,
        'actual production draw commands change position independently of alpha');
      assert.equal(boundsReads, initialBoundsReads, 'idle frames never remeasure Home layout');
      assert.ok(regions.every(({ style }) => Number(style.getPropertyValue('--home-background-luminance')) >= 0.2));
      assert.ok(change().changed > 0.2, 'motion is not confined to a few points');
      for (let i = 0; i < 30; i++) frame();
      assert.ok(change().mean > 0.18, 'rendered flow continues through about two seconds');
      assert.equal(canvas.dataset.glyph, '');
      assert.equal(canvas.dataset.transitionRevision, '0');
      assert.equal(canvas.dataset.renderMode, 'animated');
      assert.equal(callbacks.size, 1);
    }
    assert.equal(hitTests, 0, 'idle motion does not require text hit tests');
    assert.equal(canvas.dataset.pointMotion, 'seeded-diagonal-flow');
    const beforeScrollBounds = boundsReads;
    window.dispatchEvent(new Event('scroll'));
    frame();
    assert.equal(boundsReads, beforeScrollBounds + regions.length, 'scroll invalidates cached bounds once');
    const localSamples = [...canvas.positions].filter(([, [x, y]]) => x >= 84 && x <= 140 && y >= 84 && y <= 140)
      .map(([key]) => canvas.dots.get(key));
    const localLight = Math.min(1, Math.max(0, ...localSamples) + 0.2);
    assert.ok(Math.abs(Number(regions[2].style.getPropertyValue('--home-background-luminance')) - localLight) < 0.003,
      'local text response uses actual visible dot alphas at the current locations, including edge fades');
    const oldCount = Number(canvas.dataset.pointCount);
    [window.innerWidth, window.innerHeight] = [1180, 757];
    window.dispatchEvent(new Event('resize'));
    for (let index = 0; index < 5; index++) frame();
    const newborn = [...canvas.dots].find(([id]) => Number(id) >= oldCount && expectedById.get(id).luminance > 0.05);
    assert.ok(newborn, 'observe a newly enabled star rather than checking only slot counters');
    const presence = 5 * 0.034 / 0.5;
    const eased = presence * presence * (3 - 2 * presence);
    assert.ok(Math.abs(newborn[1] / expectedById.get(newborn[0]).luminance - eased) < 1e-9,
      'actual new-star alpha follows the smooth bounded resize fade');
    const fadingDots = new Map(canvas.dots);
    const fadingPositions = new Map(canvas.positions);
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    time += 60000;
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    frame();
    assert.deepEqual(canvas.dots, fadingDots, 'hidden time does not complete a pending population fade');
    assert.deepEqual(canvas.positions, fadingPositions);
    for (let index = 0; index < 30; index++) frame();
    verifyIdleAlpha = false;
    [window.innerWidth, window.innerHeight] = [1180, 757];
    window.dispatchEvent(new Event('resize'));
    for (let i = 0; i < 120; i++) {
      hit = String.fromCodePoint(0x4e00 + i);
      updateCursorPointer(1, 1);
      frame();
      assert.equal(canvas.dataset.glyph, hit);
      if (i === 0) {
        assert.ok(Number(canvas.dataset.transitionPending) > 0);
        assert.ok(Number(canvas.dataset.transitionActive) > 0);
      }
      if (i % 10 === 0) {
        [window.innerWidth, window.innerHeight] = [[390, 844], [3840, 2160], [1180, 757]][i / 10 % 3];
        window.dispatchEvent(new Event('resize'));
      }
      assert.equal(callbacks.size, 1, 'one RAF, never per-point timers');
      assert.ok(Number(canvas.dataset.transitionAtlasBytes) <= GLYPH_ATLAS_MAX_BYTES);
      assert.ok(atlases.reduce((bytes, image) => bytes + image.width * image.height * 4, 0) <= GLYPH_ATLAS_MAX_BYTES);
      const live = canvases.filter((image) => image !== canvas && image.width && image.height);
      assert.ok(live.length <= 34, 'only two atlases plus at most 32 glyph sprites');
      assert.deepEqual(canvases.slice(1, 3), atlases, 'resize never creates replacement atlases');
    }
    assert.equal(Number(canvas.dataset.transitionRevision), 120);
    const frozenRange = [canvas.dataset.transitionDelayMinMs, canvas.dataset.transitionDelayMaxMs];
    for (let i = 0; i < 5; i++) { updateCursorPointer(2, 2); frame(); }
    assert.equal(Number(canvas.dataset.transitionRevision), 120);
    assert.deepEqual([canvas.dataset.transitionDelayMinMs, canvas.dataset.transitionDelayMaxMs], frozenRange);
    hit = '';
    clearCursorPointer();
    for (let i = 0; i < 30; i++) frame();
    assert.equal(canvas.dataset.glyph, '');
    assert.equal(canvas.dataset.transitionPending, '0');
    assert.equal(canvas.dataset.transitionActive, '0');

    // Run both spatial seams through the actual RAF handler at low point count.
    // This supplements the pure long-interval/density checks without a browser.
    verifyIdleAlpha = true;
    [window.innerWidth, window.innerHeight] = [80, 60];
    window.dispatchEvent(new Event('resize'));
    for (let index = 0; index < 3500; index++) frame();
    [window.innerWidth, window.innerHeight] = [390, 844];
    window.dispatchEvent(new Event('resize'));
    const beforeHidden = new Map(canvas.dots);
    const beforeHiddenPositions = new Map(canvas.positions);
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(callbacks.size, 0);
    time += 60000;
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(callbacks.size, 1);
    frame();
    assert.deepEqual(canvas.dots, beforeHidden, 'visibility resumes the paused clock without fast-forward');
    assert.deepEqual(canvas.positions, beforeHiddenPositions, 'spatial drift also resumes without a jump');

    const beforeReducedMotion = new Map(canvas.positions);
    motion.matches = true;
    motion.dispatchEvent(new Event('change'));
    assert.deepEqual(canvas.positions, beforeReducedMotion,
      'switching reduced motion on freezes the current position without a reset jump');
    assert.equal(callbacks.size, 0, 'reduced motion has no standing RAF');
    const reducedMotionDots = new Map(canvas.dots);
    const reducedMotionPositions = new Map(canvas.positions);
    time += 5000;
    window.dispatchEvent(new Event('resize'));
    assert.deepEqual(canvas.dots, reducedMotionDots, 'reduced-motion redraws keep the idle field frozen');
    assert.deepEqual(canvas.positions, reducedMotionPositions, 'reduced motion freezes position as well as luminance');
    verifyIdleAlpha = false;
    hit = '藤';
    updateCursorPointer(1, 1);
    assert.equal(canvas.dataset.glyph, '藤');
    assert.equal(canvas.dataset.transitionPending, '0');
    assert.equal(canvas.dataset.transitionActive, '0');
    const staticGlyphPositions = new Map(canvas.positions);
    assert.ok(staticGlyphPositions.size > 0, 'resume comparison observes actual glyph draw commands');
    motion.matches = false;
    motion.dispatchEvent(new Event('change'));
    assert.equal(callbacks.size, 1);
    frame();
    assert.deepEqual(canvas.positions, staticGlyphPositions, 'turning motion back on resumes from the same phase');
    clearCursorPointer();
    for (let i = 0; i < 30; i++) frame();
    const beforePageHide = new Map(canvas.dots);
    const beforePageHidePositions = new Map(canvas.positions);
    window.dispatchEvent(new Event('pagehide'));
    assert.equal(callbacks.size, 0);
    time += 60000;
    window.dispatchEvent(new Event('pageshow'));
    assert.equal(callbacks.size, 1);
    frame();
    assert.deepEqual(canvas.dots, beforePageHide, 'pageshow resumes without an elapsed-time jump');
    assert.deepEqual(canvas.positions, beforePageHidePositions);

    // A reduced-motion resize can arrive while hidden. Settle membership without
    // drawing or starting RAF, then resume the correct pool at the frozen phase.
    motion.matches = true;
    motion.dispatchEvent(new Event('change'));
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    [window.innerWidth, window.innerHeight] = [80, 60];
    window.dispatchEvent(new Event('resize'));
    assert.equal(canvas.dataset.pointCount, canvas.dataset.targetPointCount,
      'hidden reduced-motion resize cannot retain an obsolete retiring tail');
    assert.equal(callbacks.size, 0);
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(callbacks.size, 0);
    const resizedStatic = new Map(canvas.positions);
    motion.matches = false;
    motion.dispatchEvent(new Event('change'));
    frame();
    assert.deepEqual(canvas.positions, resizedStatic);

    document.dispatchEvent(new Event('astro:before-swap'));
    assert.equal(callbacks.size, 0);
    assert.equal(regions[0].style.getPropertyValue('--home-background-luminance'), '0.333');
    assert.equal(regions[1].style.getPropertyValue('--home-background-luminance'), '');
    assert.ok(canvases.slice(1).every((image) => image.width === 0 && image.height === 0));
    const drawsBefore = drawCalls;
    const countBefore = canvases.length;
    window.dispatchEvent(new Event('resize'));
    updateCursorPointer(3, 3);
    assert.equal(drawCalls, drawsBefore);
    assert.equal(canvases.length, countBefore);
    cleanup(); // Idempotent after Astro cleanup.
  } finally {
    cleanup?.();
    clearCursorPointer();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
