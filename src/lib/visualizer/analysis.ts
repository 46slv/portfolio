export type DemoPreset = 'mono' | 'phase90' | 'ratio12' | 'antiphase' | 'silentRight';
export function rms(data: Float32Array) {
  if (!data.length) return 0;
  let sum = 0;
  for (const value of data) sum += value * value;
  return Math.sqrt(sum / data.length);
}
export function correlation(left: Float32Array, right: Float32Array) {
  let cross = 0, ll = 0, rr = 0;
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    cross += left[i] * right[i]; ll += left[i] ** 2; rr += right[i] ** 2;
  }
  return ll && rr ? cross / Math.sqrt(ll * rr) : null;
}
/** One common index set for paired channels, always inside both arrays. */
export function sampleIndices(length: number, cap: number) {
  const count = Math.min(Math.max(0, Math.floor(length)), Math.max(0, Math.floor(cap)));
  if (count <= 1) return count ? [0] : [];
  return Array.from({ length: count }, (_, i) => Math.floor(i * (length - 1) / (count - 1)));
}
export function demoPcm(left: Float32Array, right: Float32Array, preset: DemoPreset, seconds: number, sampleRate = 48000) {
  // Demo is generated PCM only, never connected to the speakers or a microphone.
  const frequency = 375; // integer periods at the default buffer / sample rate
  for (let i = 0; i < left.length; i++) {
    const phase = 2 * Math.PI * frequency * (seconds + i / sampleRate);
    left[i] = Math.sin(phase) * 0.65;
    right[i] = preset === 'silentRight' ? 0 : Math.sin(phase * (preset === 'ratio12' ? 2 : 1)
      + (preset === 'phase90' ? Math.PI / 2 : preset === 'antiphase' ? Math.PI : 0)) * 0.65;
  }
}
/** Bounded logarithmic aggregation; no hundreds of narrow bars on large displays. */
export function frequencyBands(input: Uint8Array, output: Uint8Array) {
  for (let i = 0; i < output.length; i++) {
    const start = Math.floor(Math.pow(input.length + 1, i / output.length)) - 1;
    const end = Math.max(start + 1, Math.floor(Math.pow(input.length + 1, (i + 1) / output.length)) - 1);
    let peak = 0;
    for (let bin = start; bin < Math.min(input.length, end); bin++) peak = Math.max(peak, input[bin]);
    output[i] = peak;
  }
}
