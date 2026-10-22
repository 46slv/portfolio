import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { colorFromHex, changeColorHue } from '../src/lib/visualizer-color.ts';

const source = await readFile(new URL('../src/components/Visualizer.astro', import.meta.url), 'utf8');
const between = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Visualizer source section: ${start}`);
  return source.slice(from, to);
};

// Execute the actual knob, preset and reset handlers against small DOM doubles.
// This covers event/state wiring, not browser pixels, focus or native scrolling.
const javascript = ts.transpileModule([
  between('\n  class KnobEngine {', '\n  const dpr ='),
  between('\n  let currentVolume = 0;', '\n  const setScopeOnly ='),
  between('\n  const applyKnob =', '\n  const collectAudioFrame ='),
  between('\n  const resetParams =', '\n  if (!IS_MINI) {'),
  between("    ROOT.querySelector('#color-select')\n      ?.addEventListener(", "    ROOT.querySelector('#adaptive-btn')"),
  `globalThis.subject = {
    reset: resetParams,
    set: (id, value) => knobEngine.set(id, value),
    snapshot: () => JSON.stringify({ ...colorState, accent: ACCENT }),
  };`,
].join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const close = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`,
);

function mount() {
  const eventTarget = (properties = {}) => ({
    ...properties,
    listeners: new Map(),
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    emit(type, properties = {}) {
      let prevented = false;
      this.listeners.get(type)?.({
        target: this, currentTarget: this, ...properties,
        preventDefault() { prevented = true; },
      });
      return prevented;
    },
  });
  const selectMarkup = between('<select id="color-select"', '</select>');
  const select = eventTarget({
    value: '#36ff72',
    options: Array.from(selectMarkup.matchAll(/<option value="([^"]+)"/g), ([, value]) => ({ value })),
  });
  const canvases = [
    ['hue', 0, 360, 136, 'deg'],
    ['beam', 0.4, 3, 1, 'x1'],
  ].map(([id, min, max, val, fmt]) => {
    const pen = {
      setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {},
      stroke() { if (this.shadowBlur === 8) this.accent = this.strokeStyle; },
    };
    return eventTarget({
      dataset: { id, min: String(min), max: String(max), val: String(val), fmt },
      getBoundingClientRect: () => ({ width: 58 }),
      getContext: () => pen,
      setPointerCapture() {},
    });
  });
  const labels = new Map(canvases.map((canvas) => [canvas.dataset.id, { textContent: '' }]));
  const style = new Map([['--accent', '#36ff72']]);
  const root = {
    dataset: { color: '#36ff72' },
    style: { setProperty: (name, value) => style.set(name, value) },
    querySelectorAll: () => canvases,
    querySelector(selector) {
      if (selector === '#color-select') return select;
      if (selector === '[data-id="hue"]') return canvases[0];
      return labels.get(selector.match(/\[data-for="(.+)"\]/)?.[1]) ?? null;
    },
  };
  const messages = [];
  const resets = [];
  const params = {};
  const context = {
    ROOT: root, ACCENT: '#36ff72', IS_MINI: false,
    window: { devicePixelRatio: 1 },
    colorFromHex, changeColorHue, normalizeAccent: (color) => color,
    worker: { postMessage: (message) => messages.push(message) },
    params, engine: null, ultraMinimal: false, motionSpeed: 1, pixelMap: true,
    setScopeOnly: (active) => resets.push(['scopeOnly', active]),
    setMode: (mode) => resets.push(['mode', mode]),
  };
  vm.runInNewContext(javascript, context);
  return {
    ...context.subject, params, messages, resets,
    state() {
      return {
        ...JSON.parse(context.subject.snapshot()),
        selected: select.value, rootAccent: style.get('--accent'),
        rootColor: root.dataset.color, knob: Number(canvases[0].dataset.val),
        label: labels.get('hue').textContent,
        rings: canvases.map((canvas) => canvas.getContext().accent),
      };
    },
    preset(value) { select.value = value; select.emit('change'); },
    wheel(deltaY, shiftKey = false, id = 'hue') {
      return canvases.find((canvas) => canvas.dataset.id === id).emit('wheel', { deltaY, shiftKey });
    },
    pointer(type, properties) { canvases[0].emit(type, properties); },
  };
}

const presets = ['#36ff72', '#ffb000', '#7fd8ff', '#ff4dff', '#ffff00', '#f4f4f4'];

test('hex presets derive their real hue and preserve exact selected colors', () => {
  const expectedHues = [137.910447761194, 41.411764705882, 198.28125, 300, 60];
  for (const [index, hex] of presets.entries()) {
    const state = colorFromHex(hex, 42);
    assert.equal(state.color, hex);
    assert.equal(state.preset, hex);
    close(state.hue, expectedHues[index] ?? 42);
    assert.equal(changeColorHue(state, state.hue), state, 'unchanged hue is not a custom edit');
  }
  close(colorFromHex('#7fd8ff').lightness, 74.90196078431373);
  assert.equal(colorFromHex('#f4f4f4').saturation, 0);
  assert.throws(() => colorFromHex('not a color'));
});

test('initial knob and preset agree without changing the original accent', () => {
  const ui = mount();
  const state = ui.state();
  assert.equal(state.selected, '#36ff72');
  assert.equal(state.accent, '#36ff72');
  assert.equal(state.rootAccent, '#36ff72');
  close(state.knob, colorFromHex('#36ff72').hue);
  assert.equal(state.label, '138deg');
  assert.equal(ui.messages.length, 0, 'initializing Hue must not overwrite the preset');
});

test('ICE BLUE then wheel in either direction starts at blue, preserving saturation and lightness', () => {
  for (const direction of [-1, 1]) {
    const ui = mount();
    ui.preset('#7fd8ff');
    const before = ui.state();
    close(before.knob, 198.28125);
    assert.equal(before.label, '198deg');
    assert.equal(before.accent, '#7fd8ff');
    assert.equal(ui.wheel(direction * 100), true, 'knob wheel prevents page scrolling');
    const after = ui.state();
    close(after.hue, before.hue - direction * 9);
    close(after.knob, after.hue);
    assert.equal(after.saturation, before.saturation);
    assert.equal(after.lightness, before.lightness);
    assert.equal(after.preset, null);
    assert.equal(after.selected, 'custom');
    assert.match(after.accent, /^hsl\((189|207)\.2813 100% 74\.902%\)$/);
    assert.equal(after.rootAccent, after.accent);
    assert.equal(after.rootColor, after.accent);
    assert.ok(after.rings.every((accent) => accent === after.accent));
    assert.equal(ui.messages.at(-1).value, after.accent);
  }
});

test('switching presets after custom Hue restores each exact color and synchronizes the next edit', () => {
  const ui = mount();
  for (const hex of [...presets, '#7fd8ff', '#ffb000']) {
    ui.preset(hex);
    const before = ui.state();
    assert.equal(before.selected, hex);
    assert.equal(before.accent, hex);
    close(before.knob, before.hue);
    ui.wheel(-100);
    const after = ui.state();
    close(after.hue, Math.min(360, before.hue + 9));
    assert.equal(after.saturation, before.saturation);
    assert.equal(after.lightness, before.lightness);
    assert.equal(after.selected, 'custom');
  }
});

test('fine wheel retains fractional hue; boundaries and zero wheel events do not drift', () => {
  const ui = mount();
  ui.preset('#7fd8ff');
  ui.wheel(-1, true);
  close(ui.state().hue, 198.28125 + 1.44);
  assert.match(ui.state().accent, /^hsl\(199\.7212 /);
  ui.wheel(1, true);
  close(ui.state().hue, 198.28125);
  for (const [delta, boundary] of [[-100, 360], [100, 0]]) {
    for (let step = 0; step < 45; step++) ui.wheel(delta);
    assert.equal(ui.state().knob, boundary);
    assert.equal(ui.state().hue, boundary);
    const before = ui.state();
    const count = ui.messages.length;
    ui.wheel(delta);
    ui.wheel(0);
    assert.deepEqual(ui.state(), before);
    assert.equal(ui.messages.length, count, 'clamped/no-op wheel must not reapply color');
  }
  const beamBefore = ui.params.beam;
  ui.wheel(-100, false, 'beam');
  close(ui.params.beam, beamBefore + (3 - 0.4) * 0.025);
});

test('Hue dragging uses the same color state and preserves the selected pastel lightness', () => {
  const ui = mount();
  ui.preset('#7fd8ff');
  const before = ui.state();
  ui.pointer('pointerdown', { clientY: 100, pointerId: 1 });
  ui.pointer('pointermove', { clientY: 50, shiftKey: true });
  ui.pointer('pointerup');
  close(ui.state().hue, before.hue + 18);
  assert.equal(ui.state().lightness, before.lightness);
  assert.equal(ui.state().selected, 'custom');
});

test('TERMINAL WHITE keeps its previous hue but remains neutral through wheel edits', () => {
  const ui = mount();
  ui.preset('#7fd8ff');
  ui.wheel(-100);
  const previousHue = ui.state().hue;
  ui.preset('#f4f4f4');
  close(ui.state().knob, previousHue);
  assert.equal(ui.state().accent, '#f4f4f4');
  ui.wheel(100);
  assert.equal(ui.state().saturation, 0);
  close(ui.state().lightness, 244 / 255 * 100);
  assert.match(ui.state().accent, / 0% 95\.6863%\)$/);
  assert.equal(ui.state().selected, 'custom');
});

test('RESET after custom/white restores default color, knob, mode and other controls together', () => {
  for (const hex of ['#7fd8ff', '#f4f4f4']) {
    const ui = mount();
    ui.preset(hex);
    ui.wheel(-100);
    ui.set('beam', 2.4);
    ui.reset();
    const state = ui.state();
    assert.equal(state.accent, '#36ff72');
    assert.equal(state.rootColor, '#36ff72');
    assert.equal(state.selected, '#36ff72');
    assert.equal(state.preset, '#36ff72');
    close(state.knob, colorFromHex('#36ff72').hue);
    assert.equal(state.label, '138deg');
    assert.ok(state.rings.every((accent) => accent === '#36ff72'), 'all knob rings use the final reset accent');
    assert.equal(ui.params.beam, 1);
    assert.deepEqual(ui.resets, [['scopeOnly', false], ['mode', 'scope']]);
  }
});
