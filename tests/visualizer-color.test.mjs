import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorFromHex, changeColorHue } from '../src/lib/visualizer-color.ts';
import { bindColorControls } from '../src/lib/visualizer/ColorControls.ts';
import { colorRgb } from '../src/lib/visualizer/model.ts';
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
function mount() {
  const element = (value = '') => Object.assign(new EventTarget(), { value });
  const select = element('#36ff72'), hue = element(), output = element();
  const style = new Map(), changes = [];
  const root = { dataset: { color: '#36ff72' }, style: { setProperty: (key, value) => style.set(key, value) },
    querySelector: (selector) => ({ '#color-select': select, '#hue': hue, '#hue-value': output })[selector] };
  const controls = bindColorControls(root, (state, rgb) => changes.push({ ...state, rgb }));
  return { controls, changes,
    state: () => ({ ...controls.state, selected: select.value, slider: Number(hue.value), label: output.value, accent: style.get('--accent'), rootColor: root.dataset.color }),
    preset(value) { select.value = value; select.dispatchEvent(new Event('change')); },
    hue(value) { hue.value = String(value); hue.dispatchEvent(new Event('input')); },
  };
}
const presets = ['#36ff72', '#ffb000', '#7fd8ff', '#ff4dff', '#ffff00', '#f4f4f4'];
test('hex presets derive their real hue and preserve exact selected colors', () => {
  const expected = [137.910447761194, 41.411764705882, 198.28125, 300, 60];
  presets.forEach((hex, i) => {
    const state = colorFromHex(hex, 42);
    assert.equal(state.color, hex); assert.equal(state.preset, hex);
    close(state.hue, expected[i] ?? 42);
    assert.equal(changeColorHue(state, state.hue), state);
    assert.deepEqual(colorRgb(state), [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)));
  });
  close(colorFromHex('#7fd8ff').lightness, 74.90196078431373);
  assert.equal(colorFromHex('#f4f4f4').saturation, 0); assert.throws(() => colorFromHex('not a color'));
});
test('initial native hue and preset agree without overwriting the exact accent', () => {
  const ui = mount(), state = ui.state();
  assert.equal(state.selected, '#36ff72'); assert.equal(state.color, '#36ff72');
  close(state.slider, colorFromHex('#36ff72').hue); assert.equal(state.label, '138°'); assert.equal(ui.changes.length, 0);
});
test('ICE BLUE then native Hue in either direction starts at blue and preserves pastel saturation/lightness', () => {
  for (const direction of [-1, 1]) {
    const ui = mount(); ui.preset('#7fd8ff'); const before = ui.state(); ui.hue(before.hue + direction * 9); const after = ui.state();
    close(before.slider, 198.28125); assert.equal(before.color, '#7fd8ff');
    close(after.hue, before.hue + direction * 9); assert.equal(after.saturation, before.saturation); assert.equal(after.lightness, before.lightness);
    assert.equal(after.preset, null); assert.equal(after.selected, 'custom'); assert.equal(after.rootColor, after.color); assert.equal(after.accent, after.color);
    assert.match(after.color, /^hsl\((189|207)\.2813 100% 74\.902%\)$/);
  }
});
test('switching presets after custom Hue restores each exact color and synchronizes next edit', () => {
  const ui = mount();
  for (const hex of [...presets, '#7fd8ff', '#ffb000']) {
    ui.preset(hex); const before = ui.state();
    assert.equal(before.selected, hex); assert.equal(before.color, hex); close(before.slider, before.hue);
    ui.hue(before.hue + 9); const after = ui.state();
    close(after.hue, Math.min(360, before.hue + 9)); assert.equal(after.saturation, before.saturation); assert.equal(after.lightness, before.lightness);
    assert.equal(after.selected, 'custom');
  }
});
test('fractional hue, boundaries and no-op native inputs do not drift or reapply color', () => {
  const ui = mount(); ui.preset('#7fd8ff'); ui.hue(198.28125 + 1.44); close(ui.state().hue, 199.72125);
  assert.match(ui.state().color, /^hsl\(199\.7212 /); ui.hue(198.28125); close(ui.state().hue, 198.28125);
  for (const value of [-10, 370]) {
    ui.hue(value); const expected = Math.max(0, Math.min(360, value)); assert.equal(ui.state().hue, expected);
    const count = ui.changes.length; ui.hue(expected); assert.equal(ui.changes.length, count);
  }
});
test('TERMINAL WHITE retains previous hue and remains neutral through native hue edits', () => {
  const ui = mount(); ui.preset('#7fd8ff'); ui.hue(207.28125); ui.preset('#f4f4f4');
  close(ui.state().slider, 207.28125); assert.equal(ui.state().color, '#f4f4f4'); ui.hue(190);
  assert.equal(ui.state().saturation, 0); close(ui.state().lightness, 244 / 255 * 100);
  assert.match(ui.state().color, / 0% 95\.6863%\)$/); assert.deepEqual(ui.changes.at(-1).rgb, [244, 244, 244]);
});
test('RESET after custom/white restores exact green, synchronized native controls and renderer RGB', () => {
  for (const hex of ['#7fd8ff', '#f4f4f4']) {
    const ui = mount(); ui.preset(hex); ui.hue(20); ui.controls.reset(); const state = ui.state();
    for (const value of [state.color, state.rootColor, state.accent, state.selected, state.preset]) assert.equal(value, '#36ff72');
    close(state.slider, colorFromHex('#36ff72').hue); assert.equal(state.label, '138°'); assert.deepEqual(ui.changes.at(-1).rgb, [54, 255, 114]);
    ui.controls.dispose(); const count = ui.changes.length; ui.hue(60); assert.equal(ui.changes.length, count);
  }
});
