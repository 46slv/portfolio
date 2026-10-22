import type { VisualizerColor } from '../visualizer-color.ts';

export type Mode = 'scope' | 'spectrum' | 'lissajous' | 'radial' | 'waterfall' | 'particle';
export type ModeControl = 'window' | 'trail' | 'grid';
export const MODES: Record<Mode, { label: string; description: string; analysis: 'mono' | 'stereo' | 'frequency'; controls: readonly ModeControl[]; cap: number }> = {
  scope: { label: 'OSC', description: 'Amplitude over time. The center line is zero.', analysis: 'mono', controls: ['window', 'trail', 'grid'], cap: 1024 },
  spectrum: { label: 'Spectrum', description: 'Frequency energy, low to high. Relative level, not calibrated dB SPL.', analysis: 'frequency', controls: ['grid'], cap: 192 },
  lissajous: { label: 'XY', description: 'Left → X · Right → Y (positive up). Mono is a diagonal; silent stereo R stays silent.', analysis: 'stereo', controls: ['trail', 'grid'], cap: 1024 },
  radial: { label: 'Radial', description: 'A circular time-domain trace for presentation.', analysis: 'mono', controls: ['trail'], cap: 512 },
  waterfall: { label: 'Waterfall', description: 'Frequency history. Newest at the bottom; low frequencies at the left.', analysis: 'frequency', controls: [], cap: 128 },
  particle: { label: 'Particles', description: 'A bounded, frequency-reactive presentation field.', analysis: 'frequency', controls: [], cap: 96 },
};
export type Quality = 'eco' | 'balanced' | 'high';
export const QUALITIES = {
  eco: { label: 'Eco · 24 fps', fps: 24, pixels: 460800, dimension: 1280, fft: 1024, bands: 128 },
  balanced: { label: 'Balanced · 30 fps', fps: 30, pixels: 921600, dimension: 1920, fft: 1024, bands: 128 },
  high: { label: 'High · 60 fps', fps: 60, pixels: 2073600, dimension: 2048, fft: 2048, bands: 192 },
} as const;
export interface ViewSettings {
  mode: Mode; quality: Quality; gain: number; window: number; trail: number;
  beam: number; glow: number; grid: boolean; color: string; rgb: readonly number[];
}
export function defaultSettings(): ViewSettings {
  return { mode: 'scope', quality: 'balanced', gain: 1, window: 512, trail: 0,
    beam: 1, glow: 0, grid: true, color: '#36ff72', rgb: [54, 255, 114] };
}
/** Absolute area/dimension caps apply even on Retina / large fullscreen displays. */
export function backingSize(width: number, height: number, dpr: number, quality: Quality) {
  const q = QUALITIES[quality];
  width = Math.max(1, width || 1); height = Math.max(1, height || 1);
  const scale = Math.min(Math.max(1, dpr || 1), Math.sqrt(q.pixels / (width * height)), q.dimension / width, q.dimension / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
export function colorRgb(state: VisualizerColor): readonly number[] {
  if (state.preset) return [1, 3, 5].map((offset) => parseInt(state.preset!.slice(offset, offset + 2), 16));
  const s = state.saturation / 100, l = state.lightness / 100;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => {
    const k = (n + state.hue / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  });
}
export interface AudioFrame { mono?: Float32Array; left?: Float32Array; right?: Float32Array; frequency?: Uint8Array; }
export interface RenderFrame { frameId: number; generation: number; now: number; settings: ViewSettings; audio: AudioFrame; }
export interface FrameAck { type: 'ack'; frameId: number; generation: number; drawMs: number; }
