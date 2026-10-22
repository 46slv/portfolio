import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { MODES, QUALITIES, defaultSettings, backingSize } from '../src/lib/visualizer/model.ts';
import { rms, correlation, sampleIndices, demoPcm, frequencyBands } from '../src/lib/visualizer/analysis.ts';
import { FramePump } from '../src/lib/visualizer/FramePump.ts';
import { VisualizerRenderer } from '../src/lib/visualizer/Renderer.ts';
import { RenderTransport } from '../src/lib/visualizer/RenderTransport.ts';
const close = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
class RecordingSurface {
  width = 640; height = 400;
  constructor() {
    this.log = []; const log = this.log;
    this.pen = new Proxy({ createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) }, {
      get(target, key) { if (key in target) return target[key]; return (...args) => log.push([key, ...args.map((arg) => arg instanceof RecordingSurface ? 'bitmap' : arg?.data ? [arg.width, arg.height, arg.data.length] : arg)]); },
      set(target, key, value) { target[key] = value; log.push(['style', key, value]); return true; },
    });
  }
  getContext() { if (this.transferred) throw new Error('transferred'); return this.pen; }
  transferControlToOffscreen() { this.transferred = true; return new RecordingSurface(); }
  cloneNode() { return new RecordingSurface(); }
  replaceWith(replacement) { this.replacement = replacement; }
}
const audio = () => {
  const mono = new Float32Array(2048), left = new Float32Array(2048), right = new Float32Array(2048);
  demoPcm(left, right, 'phase90', 0); mono.set(left);
  return { mono, left, right, frequency: new Uint8Array(192).fill(128) };
};
const frame = (mode, now = 100) => ({ frameId: 1, generation: 1, now, settings: { ...defaultSettings(), mode }, audio: audio() });
test('PCM silence, sine RMS and impulse are numerically correct', () => {
  assert.equal(rms(new Float32Array(1024)), 0);
  const sine = Float32Array.from({ length: 1024 }, (_, i) => Math.sin(i / 1024 * Math.PI * 16)); close(rms(sine), Math.SQRT1_2);
  const impulse = new Float32Array(1024); impulse[512] = 1; close(rms(impulse), 1 / 32);
});
test('deterministic PCM preserves mono, antiphase, quadrature, ratio 1:2 and silent stereo R', () => {
  const left = new Float32Array(1024), right = new Float32Array(1024);
  for (const [preset, expected] of [['mono', 1], ['antiphase', -1], ['phase90', 0], ['ratio12', 0], ['silentRight', null]]) {
    demoPcm(left, right, preset, 0);
    if (expected === null) { assert.equal(correlation(left, right), null); assert.equal(rms(right), 0); assert.ok(rms(left) > 0); }
    else close(correlation(left, right), expected);
    close(rms(left), 0.65 * Math.SQRT1_2);
  }
});
test('common paired sample indices are bounded and endpoint-inclusive even for short/mismatched buffers', () => {
  for (const length of [0, 1, 2, 3, 257, 1024, 4096]) for (const cap of [0, 1, 2, 96, 1024]) {
    const indices = sampleIndices(length, cap);
    assert.equal(indices.length, Math.min(length, cap)); assert.equal(new Set(indices).size, indices.length);
    assert.ok(indices.every((i) => i >= 0 && i < length));
    if (indices.length > 1) { assert.equal(indices[0], 0); assert.equal(indices.at(-1), length - 1); }
  }
});
test('all quality budgets cap area and dimensions independently of DPR and extreme viewports', () => {
  for (const quality of Object.keys(QUALITIES)) for (const [w, h] of [[1440, 900], [390, 844], [3840, 2160], [100000, 1], [1, 100000]]) for (const dpr of [1, 2, 4]) {
    const size = backingSize(w, h, dpr, quality), q = QUALITIES[quality];
    assert.ok(size.width * size.height <= q.pixels); assert.ok(Math.max(size.width, size.height) <= q.dimension);
  }
});
test('frequency aggregation is bounded, retains silence and includes high-end bins', () => {
  const input = new Uint8Array(4096), out = new Uint8Array(128);
  frequencyBands(input, out); assert.ok(out.every((v) => v === 0));
  input[4095] = 255; frequencyBands(input, out); assert.equal(out.at(-1), 255);
});
test('fake-clock producer enforces deadlines, one in-flight frame, stop/hidden suspension and stale ACK protection', () => {
  const pump = new FramePump(); pump.setActive(true);
  const a = pump.issue(0); assert.ok(a); assert.equal(pump.issue(1), null); assert.equal(pump.issue(40), null); assert.equal(pump.skippedBusy, 1);
  assert.equal(pump.ack(a.frameId + 1, a.generation, 3, 41), false); assert.equal(pump.pending, a);
  pump.setHidden(true); assert.equal(pump.issue(400), null);
  assert.equal(pump.ack(a.frameId, a.generation, 3, 400), false); assert.equal(pump.pending, null); assert.equal(pump.outputFps, 0);
  pump.setHidden(false); const b = pump.issue(500); assert.ok(b);
  assert.equal(pump.ack(a.frameId, a.generation, 3, 501), false); assert.equal(pump.pending, b);
  assert.equal(pump.ack(b.frameId, b.generation, 2.5, 510), true); assert.equal(pump.drawMs, 2.5); assert.equal(pump.outputFps, 1);
  pump.setActive(false); assert.equal(pump.issue(10000), null); assert.equal(pump.outputFps, 0);
  pump.setActive(true); assert.ok(pump.issue(10001)); pump.resetTransport(); assert.equal(pump.pending, null);
});
test('all six render modes produce finite bounded drawing operations with no alternate fallback implementation', () => {
  for (const mode of Object.keys(MODES)) {
    const canvas = new RecordingSurface(), bitmap = new RecordingSurface(); const renderer = new VisualizerRenderer(canvas, () => bitmap);
    renderer.draw(frame(mode));
    assert.ok(canvas.log.length > 0, mode);
    for (const call of canvas.log) for (const number of call.filter((v) => typeof v === 'number')) assert.ok(Number.isFinite(number), mode);
    const count = (op) => canvas.log.filter(([name]) => name === op).length;
    if (mode === 'spectrum') assert.ok(count('fillRect') <= 194);
    if (mode === 'waterfall') { assert.equal(count('drawImage'), 1); assert.equal(count('fillRect'), 2); assert.equal(bitmap.log.filter(([op]) => op === 'putImageData').length, 1); }
    if (mode === 'particle') assert.equal(count('arc'), 96);
    renderer.dispose();
  }
});
test('XY uses common channel indices, equal axis scale, positive Y upward and no hidden rotation', () => {
  const canvas = new RecordingSurface(), renderer = new VisualizerRenderer(canvas);
  const f = frame('lissajous'); f.settings.grid = false; f.audio = { left: new Float32Array([0, 1, -1]), right: new Float32Array([1, 0, -1, 0]) };
  renderer.draw(f);
  assert.deepEqual(canvas.log.filter(([op]) => ['moveTo', 'lineTo'].includes(op)), [['moveTo', 320, 32], ['lineTo', 488, 200], ['lineTo', 152, 368]]);
  assert.ok(!canvas.log.some(([op]) => op === 'rotate'));
});
test('time-based persistence has equal attenuation over equal elapsed time at different frame rates', () => {
  const attenuation = (fps) => {
    const canvas = new RecordingSurface(), renderer = new VisualizerRenderer(canvas); let product = 1;
    const f = frame('scope', 100); f.settings.trail = 0.3; renderer.draw(f);
    for (let i = 1; i <= fps; i++) {
      canvas.log.length = 0; f.now = 100 + i * 1000 / fps; renderer.draw(f);
      const alpha = canvas.log.find(([op, key, value]) => op === 'style' && key === 'fillStyle' && value.startsWith('rgba(0,0,0,'))[2];
      product *= 1 - Number(alpha.slice(11, -1));
    }
    return product;
  };
  close(attenuation(24), attenuation(60)); close(attenuation(30), Math.exp(-1 / 0.3));
});
test('worker consumes messages only and draws exactly the same shared operations as main-thread fallback in all modes', async () => {
  const saved = { self: globalThis.self, OffscreenCanvas: globalThis.OffscreenCanvas };
  const posts = []; globalThis.self = { postMessage: (message) => posts.push(message), close() {} }; globalThis.OffscreenCanvas = RecordingSurface;
  try {
    await import('../src/scripts/visualizer-worker.ts');
    for (const mode of Object.keys(MODES)) {
      const workerCanvas = new RecordingSurface(), directCanvas = new RecordingSurface(); const direct = new VisualizerRenderer(directCanvas);
      self.onmessage({ data: { type: 'init', canvas: workerCanvas, width: 640, height: 400 } }); direct.resize(640, 400);
      const f = frame(mode); self.onmessage({ data: { type: 'frame', frame: f } }); direct.draw(f);
      assert.deepEqual(workerCanvas.log, directCanvas.log, mode);
      const ack = posts.at(-1); assert.equal(ack.type, 'ack'); assert.equal(ack.frameId, f.frameId); assert.equal(ack.generation, f.generation); assert.ok(ack.drawMs >= 0);
      const count = workerCanvas.log.length; await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(workerCanvas.log.length, count, 'no autonomous drawing');
      self.onmessage({ data: { type: 'reset' } }); const resetCount = workerCanvas.log.length;
      await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(workerCanvas.log.length, resetCount, 'stop reset stays stopped');
    }
  } finally { Object.assign(globalThis, saved); }
});
test('transferred-canvas worker failure replaces canvas and renders all six fallback modes', () => {
  const saved = globalThis.OffscreenCanvas; globalThis.OffscreenCanvas = RecordingSurface;
  const canvas = new RecordingSurface(), notices = [], acks = [];
  const worker = { terminated: false, postMessage() {}, terminate() { this.terminated = true; } };
  const transport = new RenderTransport(canvas, (ack) => acks.push(ack), (notice) => notices.push(notice), () => worker);
  try {
    transport.resize(640, 400); worker.onerror({ preventDefault() {} });
    assert.equal(worker.terminated, true); assert.ok(canvas.replacement); assert.equal(transport.ready, true); assert.equal(notices.length, 1);
    for (const mode of Object.keys(MODES)) transport.draw(frame(mode)); assert.equal(acks.length, 6);
    assert.ok(canvas.replacement.log.some(([op]) => op === 'drawImage'));
    transport.dispose(); assert.equal(transport.ready, false);
  } finally { globalThis.OffscreenCanvas = saved; transport.dispose(); }
});
test('view markup has native labels and no global Tab/wheel prevention or overlay controls', async () => {
  const component = await readFile(new URL('../src/components/Visualizer.astro', import.meta.url), 'utf8');
  const script = await readFile(new URL('../src/scripts/visualizer.ts', import.meta.url), 'utf8');
  const page = await readFile(new URL('../src/pages/visualizer.astro', import.meta.url), 'utf8');
  assert.match(component, /grid-template-columns:minmax\(0,1fr\) 300px/); assert.match(component, /flex-direction:column/);
  assert.doesNotMatch(script + page, /event\.key === 'Tab'|preventDefault\(|'wheel'/);
  for (const id of ['monitor', 'gain', 'hue', 'beam', 'glow', 'trail', 'quality', 'color-select']) assert.ok(component.includes(`for="${id}"`));
  assert.match(component, /id="monitor"[^>]+value="0" disabled/); assert.match(component, /id="glow"[^>]+value="0"/);
});

test('anchored producer deadlines retain 24/30/60 output budgets on a 60Hz fake clock', () => {
  for (const fps of [24, 30, 60]) {
    const pump = new FramePump(); pump.fps = fps; pump.setActive(true); let draws = 0;
    for (let tick = 0; tick < 600; tick++) {
      const now = tick * 1000 / 60, issued = pump.issue(now);
      if (issued) { draws++; pump.ack(issued.frameId, issued.generation, 1, now); }
    }
    assert.ok(Math.abs(draws - fps * 10) <= 1, `${fps}: ${draws}`);
  }
});
test('waterfall retains the same 20Hz time history at all quality output rates', () => {
  for (const fps of [24, 30, 60]) {
    const surface = new RecordingSurface(), renderer = new VisualizerRenderer(surface, () => new RecordingSurface());
    for (let tick = 0; tick <= fps * 3; tick++) renderer.draw(frame('waterfall', 100 + tick * 1000 / fps));
    assert.equal(renderer.head, 61, `${fps} fps includes initial row plus 60 elapsed rows`);
  }
});

test('output diagnostics expire old ACKs even when the renderer stops acknowledging', () => {
  const pump = new FramePump(); pump.setActive(true); const issued = pump.issue(0); pump.ack(issued.frameId, issued.generation, 1, 5);
  assert.equal(pump.outputFps, 1); pump.expireOutputs(1010); assert.equal(pump.outputFps, 0);
});

test('worker watchdog excludes whole-browser stalls but recovers after two healthy visible seconds without ACK', () => {
  const pump = new FramePump(); pump.setActive(true); const issued = pump.issue(0);
  assert.equal(pump.shouldRecover(0), false); assert.equal(pump.shouldRecover(5000), false, 'a five-second main-thread stall does not implicate the worker');
  for (let time = 5010; time < 7000; time += 10) assert.equal(pump.shouldRecover(time), false);
  assert.equal(pump.shouldRecover(7020), true, 'unchanged two-second active-worker recovery budget');
  assert.equal(pump.ack(issued.frameId, issued.generation, 1, 7030), true); assert.equal(pump.shouldRecover(7040), false);
  pump.issue(7050); pump.setHidden(true); assert.equal(pump.shouldRecover(20000), false); pump.setHidden(false);
  assert.equal(pump.shouldRecover(20010), false, 'hidden duration never contributes');
});
