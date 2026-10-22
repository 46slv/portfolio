import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { GLYPH_ATLAS_MAX_BYTES, MAX_DPR } from '../src/lib/glyph-field.ts';
import { clearCursorPointer, updateCursorPointer } from '../src/lib/cursor-pointer.ts';

// Run the real renderer against small DOM/Canvas doubles. This checks scheduling,
// lifecycle and resource ownership, not actual raster pixels or browser layout.
const source = await readFile(new URL('../src/scripts/glyph-field.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace(/from '(\.\.\/lib\/[^']+)'/g,
  (_, path) => `from '${new URL(`${path}.ts`, new URL('../src/scripts/', import.meta.url)).href}'`);
const { mountGlyphField } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('renderer reuses two atlas buffers, cancels stale targets and cleans up through resize/motion/visibility', () => {
  const canvases = [];
  let drawCalls = 0;
  class Canvas {
    width = 300;
    height = 150;
    dataset = {};
    pen = {
      clearRect() {}, setTransform() {}, beginPath() {}, arc() {}, fill() {}, fillText() {}, fillRect() {},
      measureText() { return { width: 28 }; },
      drawImage(image) {
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
  let hit = '';
  const sourceElement = { closest() { return this; } };
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    documentElement: new EventTarget(),
    createElement(name) { assert.equal(name, 'canvas'); return new Canvas(); },
    elementFromPoint() { return hit ? sourceElement : null; },
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
  const frame = () => {
    const [id, callback] = callbacks.entries().next().value;
    callbacks.delete(id);
    callback(time += 34);
  };
  try {
    cleanup = mountGlyphField(canvas);
    const atlases = canvases.slice(1);
    assert.equal(atlases.length, 2);
    assert.equal(callbacks.size, 1);
    assert.equal(canvas.width, window.innerWidth * MAX_DPR);
    assert.equal(canvas.height, window.innerHeight * MAX_DPR);
    frame();
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

    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(callbacks.size, 0);
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(callbacks.size, 1);
    frame();

    motion.matches = true;
    motion.dispatchEvent(new Event('change'));
    assert.equal(callbacks.size, 0, 'reduced motion has no standing RAF');
    hit = '藤';
    updateCursorPointer(1, 1);
    assert.equal(canvas.dataset.glyph, '藤');
    assert.equal(canvas.dataset.transitionPending, '0');
    assert.equal(canvas.dataset.transitionActive, '0');
    motion.matches = false;
    motion.dispatchEvent(new Event('change'));
    assert.equal(callbacks.size, 1);
    window.dispatchEvent(new Event('pagehide'));
    assert.equal(callbacks.size, 0);
    window.dispatchEvent(new Event('pageshow'));
    assert.equal(callbacks.size, 1);
    frame();

    document.dispatchEvent(new Event('astro:before-swap'));
    assert.equal(callbacks.size, 0);
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
