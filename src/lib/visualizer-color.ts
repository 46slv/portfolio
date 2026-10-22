export interface VisualizerColor {
  hue: number;
  saturation: number;
  lightness: number;
  color: string;
  preset: string | null;
}

/** Derive the knob's actual hue without changing the selected preset's color. */
export function colorFromHex(hex: string, previousHue = 0): VisualizerColor {
  if (!/^#[\da-f]{6}$/i.test(hex)) {
    throw new Error(`Expected a six-digit color, received ${hex}`);
  }

  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const lightness = (max + min) / 2;
  let hue = previousHue;

  // White/gray has no hue. Retain the previous knob position and zero saturation
  // so turning Hue cannot suddenly turn a neutral preset into a saturated color.
  if (chroma > 0) {
    const sector = max === r ? (g - b) / chroma : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
    hue = (sector * 60 + 360) % 360;
  }

  return {
    hue,
    saturation: chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1)) * 100,
    lightness: lightness * 100,
    color: hex,
    preset: hex,
  };
}

/** Hue edits preserve the selected color's saturation and lightness. */
export function changeColorHue(state: VisualizerColor, value: number): VisualizerColor {
  const hue = Math.max(0, Math.min(360, value));
  if (hue === state.hue) return state;

  const channel = (value: number) => Number(value.toFixed(4));
  return {
    ...state,
    hue,
    color: `hsl(${channel(hue)} ${channel(state.saturation)}% ${channel(state.lightness)}%)`,
    preset: null,
  };
}
