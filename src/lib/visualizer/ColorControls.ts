import { changeColorHue, colorFromHex } from '../visualizer-color.ts';
import { colorRgb } from './model.ts';
import type { VisualizerColor } from '../visualizer-color.ts';
/** Real native-control wiring, kept independently testable from browser audio. */
export function bindColorControls(root: HTMLElement, change: (color: VisualizerColor, rgb: readonly number[]) => void) {
  const select = root.querySelector<HTMLSelectElement>('#color-select')!;
  const hue = root.querySelector<HTMLInputElement>('#hue')!;
  const output = root.querySelector<HTMLOutputElement>('#hue-value')!;
  let state = colorFromHex(root.dataset.color ?? '#36ff72');
  const render = (notify = true) => {
    select.value = state.preset ?? 'custom'; hue.value = String(state.hue);
    output.value = `${Math.round(state.hue)}°`;
    root.style.setProperty('--accent', state.color); root.dataset.color = state.color;
    if (notify) change(state, colorRgb(state));
  };
  const preset = () => { if (select.value !== 'custom') { state = colorFromHex(select.value, state.hue); render(); } };
  const input = () => {
    const next = changeColorHue(state, Number(hue.value));
    if (next === state) return;
    state = next; render();
  };
  select.addEventListener('change', preset); hue.addEventListener('input', input);
  render(false);
  return {
    get state() { return state; },
    reset() { state = colorFromHex('#36ff72'); render(); },
    dispose() { select.removeEventListener('change', preset); hue.removeEventListener('input', input); },
  };
}
