import { MODES } from './model.ts';
import type { RenderFrame, ViewSettings } from './model.ts';
import { sampleIndices } from './analysis.ts';

type Surface = HTMLCanvasElement | OffscreenCanvas;
type Pen = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const HISTORY_BANDS = 128;
const HISTORY_ROWS = 96;
export class VisualizerRenderer {
  private ctx: Pen;
  private last = 0;
  private mode = '';
  private history = new Uint8Array(HISTORY_BANDS * HISTORY_ROWS);
  private head = 0;
  private historyAt: number | null = null;
  private bitmap?: Surface;
  private image?: ImageData;
  private palette = new Uint8ClampedArray(256 * 4);
  private paletteKey = '';
  private indexCache = new Map<string, number[]>();
  private canvas: Surface;
  private createSurface: () => Surface;
  constructor(canvas: Surface, createSurface: () => Surface = () =>
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(HISTORY_BANDS, HISTORY_ROWS) : document.createElement('canvas')) {
    this.canvas = canvas; this.createSurface = createSurface;
    const ctx = canvas.getContext('2d', { alpha: false }) as Pen | null;
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
  }
  resize(width: number, height: number) {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width; this.canvas.height = height; this.reset();
  }
  reset() {
    this.last = 0; this.mode = ''; this.history.fill(0); this.head = 0; this.historyAt = null;
    this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
  dispose() { this.indexCache.clear(); this.reset(); if (this.bitmap) { this.bitmap.width = 0; this.bitmap.height = 0; } }
  private indices(length: number, cap: number) {
    const key = `${length}:${cap}`;
    if (!this.indexCache.has(key)) this.indexCache.set(key, sampleIndices(length, cap));
    return this.indexCache.get(key)!;
  }
  draw(frame: RenderFrame) {
    const { settings: s, audio, now } = frame;
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    if (this.mode !== s.mode) { this.reset(); this.mode = s.mode; }
    const dt = this.last ? Math.min(0.25, Math.max(0, (now - this.last) / 1000)) : 1 / 30;
    this.last = now;
    const trails = MODES[s.mode].controls.includes('trail') && s.trail > 0;
    const alpha = trails ? 1 - Math.exp(-dt / s.trail) : 1;
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(0,0,0,${alpha})`; ctx.fillRect(0, 0, w, h);
    if (s.grid && MODES[s.mode].controls.includes('grid')) this.grid(w, h, s.mode === 'lissajous');
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
    ctx.lineWidth = s.beam * Math.max(1, Math.min(w, h) / 600);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = s.color; ctx.shadowBlur = s.glow ? s.glow * 6 : 0;
    switch (s.mode) {
      case 'scope': {
        const data = audio.mono;
        if (!data?.length) break;
        const length = Math.min(data.length, s.window);
        // Positive-going zero crossing stabilizes a periodic trace. Never reinterpret channel phase.
        let start = 0;
        for (let i = 1; i < data.length - length; i++) if (data[i - 1] <= 0 && data[i] > 0) { start = i; break; }
        const indices = this.indices(length, MODES.scope.cap);
        ctx.beginPath();
        indices.forEach((i, index) => {
          const x = i / Math.max(1, length - 1) * w;
          const y = h / 2 - data[start + i] * s.gain * h * 0.42;
          if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.stroke(); break;
      }
      case 'lissajous': {
        if (!audio.left || !audio.right) break;
        const indices = this.indices(Math.min(audio.left.length, audio.right.length), MODES.lissajous.cap);
        const scale = Math.min(w, h) * 0.42 * s.gain;
        ctx.beginPath();
        indices.forEach((i, index) => {
          const x = w / 2 + audio.left![i] * scale, y = h / 2 - audio.right![i] * scale;
          if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.stroke(); break;
      }
      case 'spectrum': {
        const data = audio.frequency;
        if (!data?.length) break;
        const count = Math.min(data.length, 192), step = w / count;
        for (let i = 0; i < count; i++) {
          const height = Math.min(h, data[i] / 255 * s.gain * h * 0.9);
          ctx.fillRect(i * step, h - height, Math.max(1, step - 1), height);
        }
        break;
      }
      case 'radial': {
        const data = audio.mono;
        if (!data?.length) break;
        const indices = this.indices(data.length, MODES.radial.cap);
        ctx.beginPath();
        indices.forEach((i, index) => {
          const angle = index / Math.max(1, indices.length - 1) * Math.PI * 2 - Math.PI / 2;
          const radius = Math.min(w, h) * (0.28 + data[i] * s.gain * 0.16);
          const x = w / 2 + Math.cos(angle) * radius, y = h / 2 + Math.sin(angle) * radius;
          if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.closePath(); ctx.stroke(); break;
      }
      case 'waterfall': this.waterfall(audio.frequency, now, s, w, h); break;
      case 'particle': {
        const data = audio.frequency;
        if (!data?.length) break;
        ctx.shadowBlur = 0;
        for (let i = 0; i < MODES.particle.cap; i++) {
          const energy = Math.min(1, data[Math.floor(i / MODES.particle.cap * data.length)] / 255 * s.gain);
          const x = ((i * 0.61803398875 + now / 1000 * 0.015 * (1 + i % 3)) % 1) * w;
          const y = h / 2 + Math.sin(i * 2.39 + now / 1000 * 0.4) * h * (0.08 + energy * 0.36);
          ctx.globalAlpha = 0.15 + energy * 0.85;
          ctx.beginPath(); ctx.arc(x, y, 0.8 + energy * 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1; break;
      }
    }
    ctx.shadowBlur = 0;
  }
  private grid(w: number, h: number, xy: boolean) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#17231b'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 1; i < 8; i++) { const x = w * i / 8; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let i = 1; i < 6; i++) { const y = h * i / 6; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.strokeStyle = '#35473b'; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    if (xy) { ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); }
    ctx.stroke();
  }
  private waterfall(data: Uint8Array | undefined, now: number, s: ViewSettings, w: number, h: number) {
    if (!data?.length) return;
    if (!this.bitmap) {
      this.bitmap = this.createSurface(); this.bitmap.width = HISTORY_BANDS; this.bitmap.height = HISTORY_ROWS;
      this.image = (this.bitmap.getContext('2d') as Pen).createImageData(HISTORY_BANDS, HISTORY_ROWS);
    }
    // Accumulated deadlines preserve 20 rows/second at 24, 30 and 60 output fps.
    const rows = this.historyAt === null ? 1 : Math.min(HISTORY_ROWS, Math.floor((now - this.historyAt) / 50));
    if (rows > 0) {
      for (let row = 0; row < rows; row++) {
        for (let i = 0; i < HISTORY_BANDS; i++) this.history[this.head * HISTORY_BANDS + i] = data[Math.floor(i * data.length / HISTORY_BANDS)];
        this.head = (this.head + 1) % HISTORY_ROWS;
      }
      this.historyAt = this.historyAt === null ? now : this.historyAt + rows * 50;
    }
    const key = s.rgb.join(',');
    if (key !== this.paletteKey) {
      for (let i = 0; i < 256; i++) for (let channel = 0; channel < 4; channel++) this.palette[i * 4 + channel] = channel === 3 ? 255 : s.rgb[channel] * i / 255;
      this.paletteKey = key;
    }
    const pixels = this.image!.data;
    for (let row = 0; row < HISTORY_ROWS; row++) for (let col = 0; col < HISTORY_BANDS; col++) {
      const level = Math.min(255, Math.round(this.history[((this.head + row) % HISTORY_ROWS) * HISTORY_BANDS + col] * s.gain));
      const target = (row * HISTORY_BANDS + col) * 4;
      for (let channel = 0; channel < 4; channel++) pixels[target + channel] = this.palette[level * 4 + channel];
    }
    (this.bitmap.getContext('2d') as Pen).putImageData(this.image!, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.bitmap, 0, 0, w, h);
  }
}
