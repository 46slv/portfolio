import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { defaultSettings, QUALITIES } from '../src/lib/visualizer/model.ts';

// Execute the actual reset event body, not a separate reset implementation. DOM
// doubles cover state/wiring only; parent browser QA checks native focus/pixels.
const source = await readFile(new URL('../src/scripts/visualizer.ts', import.meta.url), 'utf8');
const resetBody = source.match(/on\(get\('reset-btn'\), 'click', \(\) => \{([\s\S]*?)\n  \}\);/)?.[1];
assert.ok(resetBody, 'the reset control has a bound handler');
const javascript = ts.transpileModule(`globalThis.reset = () => {${resetBody}\n};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
test('real reset handler restores mode, beam, color, quality, grid and other view controls together without touching source/monitor', () => {
  const elements = new Map(['quality', 'time-window', 'grid', 'crt'].map((id) => [id, { value: '', checked: false }]));
  const actions = [], settings = { ...defaultSettings(), mode: 'particle', beam: 2.4, quality: 'high', gain: 3, glow: 2, trail: 0.6, color: '#f4f4f4', rgb: [244, 244, 244], grid: false };
  const context = {
    settings, defaultSettings, QUALITIES, pump: { fps: 60 }, buffers: 'old',
    get: (id) => elements.get(id), color: { reset: () => actions.push('color reset') },
    source: { state: 'mic', engine: { setFftSize: (size) => actions.push(['fft', size]) } },
    makeBuffers: () => 'fresh', root: { classList: { remove: (name) => actions.push(['remove', name]) } },
    renderRanges: () => actions.push(['ranges', settings.beam, settings.gain, settings.glow, settings.trail]),
    setMode: (mode) => actions.push(['mode', mode]), focus: (active) => actions.push(['focus', active]), resize: () => actions.push('resize'),
  };
  vm.runInNewContext(javascript, context); context.reset();
  assert.deepEqual(settings, defaultSettings()); assert.equal(context.pump.fps, 30); assert.equal(context.buffers, 'fresh');
  assert.equal(elements.get('quality').value, 'balanced'); assert.equal(elements.get('time-window').value, '512');
  assert.equal(elements.get('grid').checked, true); assert.equal(elements.get('crt').checked, false); assert.equal(context.source.state, 'mic');
  assert.deepEqual(actions, ['color reset', ['fft', 1024], ['remove', 'crt'], ['ranges', 1, 1, 0, 0], ['mode', 'scope'], ['focus', false], 'resize']);
});

const fullscreenFrom = source.indexOf("  on(get('fullscreen-btn'), 'click', () => {");
const fullscreenTo = source.indexOf("  on(document, 'fullscreenchange'", fullscreenFrom);
assert.ok(fullscreenFrom >= 0 && fullscreenTo > fullscreenFrom);
const fullscreenJavascript = ts.transpileModule(source.slice(fullscreenFrom, fullscreenTo), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function fullscreen(root = {}, document = {}) {
  const notice = { textContent: '', hidden: true }; let click;
  vm.runInNewContext(fullscreenJavascript, { root, document, get: () => notice, on: (_target, _event, handler) => { click = handler; } });
  return { click: () => click(), notice };
}
test('fullscreen explicitly reports missing enter/exit APIs instead of silently doing nothing', () => {
  for (const document of [{}, { fullscreenElement: {} }]) {
    const ui = fullscreen({}, document); ui.click();
    assert.equal(ui.notice.hidden, false); assert.match(ui.notice.textContent, /Fullscreen is unavailable.*Focus view is still available/);
  }
});
test('fullscreen preserves supported enter and exit behavior and native method receivers', async () => {
  let entered = 0, exited = 0;
  const root = { requestFullscreen() { assert.equal(this, root); entered++; return Promise.resolve(); } };
  const document = { fullscreenElement: {}, exitFullscreen() { assert.equal(this, document); exited++; return Promise.resolve(); } };
  const enter = fullscreen(root); enter.click(); enter.click(); const exit = fullscreen(root, document); exit.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(entered, 2); assert.equal(exited, 1); assert.equal(enter.notice.hidden, true); assert.equal(exit.notice.hidden, true);
});
test('fullscreen visibly handles both native promise rejection and synchronous exceptions', async () => {
  for (const requestFullscreen of [() => Promise.reject(new Error('Blocked')), () => { throw new Error('Unavailable'); }]) {
    const ui = fullscreen({ requestFullscreen }); ui.click(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ui.notice.hidden, false); assert.match(ui.notice.textContent, /Focus view is still available/);
  }
});
