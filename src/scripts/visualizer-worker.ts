type VizMode =
  | 'scope'
  | 'spectrum'
  | 'lissajous'
  | 'radial'
  | 'waterfall'
  | 'particle'
  | 'pixel_map';

type GlowQuality =
  | 'off'
  | 'low'
  | 'high';

interface RenderParams {
  targetFps: number;
  motionSpeed: number;
  sampleStep: number;
  renderScale: number;
  beam: number;
  intensity: number;
  afterglow: number;
  xScale: number;
  yScale: number;
  rotation: number;
  pixelMap: boolean;
  glowQuality: GlowQuality;
  width: number;
  height: number;
  dpr: number;
}

type WorkerInMessage =
  | { type: 'init'; canvas: OffscreenCanvas; color: string; sab?: SharedArrayBuffer; timeLength?: number; freqLength?: number }
  | { type: 'frame'; timeData?: Uint8Array<ArrayBufferLike>; freqData?: Uint8Array<ArrayBufferLike>; lissajousXData?: Uint8Array<ArrayBufferLike>; lissajousYData?: Uint8Array<ArrayBufferLike>; mode: VizMode; params: RenderParams; running: boolean }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'color'; value: string };

const WATERFALL_ROWS = 96;
const LISS_LEN = 768;
const LISS_MAX_POINTS = 1024;
const PARTICLES = 128;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let accent = '#36ff72';
let mode: VizMode = 'scope';
let running = false;
let targetFps = 60;
let lastDrawAt = 0;
let demoT = 0;

let timeData: Uint8Array<ArrayBufferLike> = new Uint8Array(2048);
let freqData: Uint8Array<ArrayBufferLike> = new Uint8Array(2048);
let lissajousXData: Uint8Array<ArrayBufferLike> = new Uint8Array(2048);
let lissajousYData: Uint8Array<ArrayBufferLike> = new Uint8Array(2048);
let sabTime: Uint8Array<ArrayBufferLike> | null = null;
let sabFreq: Uint8Array<ArrayBufferLike> | null = null;

let params: RenderParams = {
  targetFps: 60,
  motionSpeed: 1,
  sampleStep: 1,
  renderScale: 1,
  beam: 1,
  intensity: 1,
  afterglow: 0.15,
  xScale: 1,
  yScale: 1,
  rotation: 0,
  pixelMap: false,
  glowQuality: 'low',
  width: 1,
  height: 1,
  dpr: 1
};

let waterfallPool: Uint8Array[] = [];
let waterfallWrite = 0;

const particleX = new Float32Array(PARTICLES);
const particleY = new Float32Array(PARTICLES);
const particleV = new Float32Array(PARTICLES);

function initParticles() {
  for (let i = 0; i < PARTICLES; i++) {
    particleX[i] = Math.random();
    particleY[i] = Math.random();
    particleV[i] = 0.002 + Math.random() * 0.008;
  }
}

function ensureWaterfall() {
  const bins = freqData.length;

  if (
    waterfallPool.length === WATERFALL_ROWS &&
    waterfallPool[0]?.length === bins
  ) {
    return;
  }

  waterfallPool =
    Array.from(
      { length: WATERFALL_ROWS },
      () => new Uint8Array(bins)
    );

  waterfallWrite = 0;
}

function loop() {
  const now = performance.now();
  const interval =
    1000 / Math.max(1, targetFps);

  if (
    ctx &&
    canvas &&
    now - lastDrawAt >= interval * 0.92
  ) {
    lastDrawAt = now - ((now - lastDrawAt) % interval);
    draw(now);
  }

  const delay =
    Math.max(
      4,
      Math.min(
        250,
        interval * 0.5
      )
    );

  setTimeout(loop, delay);
}

function cssAlpha(hex: string, alpha: number) {
  const safe = hex.replace('#', '');
  const value =
    safe.length === 3
      ? safe.split('').map(c => c + c).join('')
      : safe;

  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);

  if (
    Number.isNaN(r) ||
    Number.isNaN(g) ||
    Number.isNaN(b)
  ) {
    return `rgba(54,255,114,${alpha})`;
  }

  const safeAlpha =
    Math.max(
      0,
      Math.min(
        1,
        alpha
      )
    );

  return `rgba(${r},${g},${b},${safeAlpha})`;
}

function glow(base: number) {
  if (params.glowQuality === 'off') {
    return 0;
  }

  if (params.glowQuality === 'high') {
    return base * 1.8 * params.intensity;
  }

  return base * 0.65 * params.intensity;
}

function getTime(i: number) {
  if (!running) {
    const x = i / Math.max(1, timeData.length - 1);

    return 128 +
      Math.sin(x * Math.PI * 8 + demoT) * 42 +
      Math.sin(x * Math.PI * 21 - demoT * 0.7) * 14;
  }

  return timeData[i] ?? 128;
}

function getFreq(i: number) {
  if (!running) {
    const x = i / Math.max(1, freqData.length - 1);

    return Math.max(
      0,
      190 * Math.exp(-x * 5) +
      Math.sin(x * 40 + demoT) * 24
    );
  }

  return freqData[i] ?? 0;
}

function draw(now: number) {
  if (!ctx || !canvas) {
    return;
  }

  demoT +=
    0.026 * params.motionSpeed;

  const w = params.width;
  const h = params.height;
  const dpr = params.dpr;
  const wl = w / dpr;
  const hl = h / dpr;
  const decay = Math.max(0.04, 1 - params.afterglow);

  ctx.fillStyle =
    `rgba(0,0,0,${decay})`;

  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.scale(dpr, dpr);

  if (mode !== 'lissajous') {
    ctx.translate(wl / 2, hl / 2);
    ctx.rotate(params.rotation * Math.PI / 180);
    ctx.translate(-wl / 2, -hl / 2);
  }

  switch (mode) {
    case 'spectrum':
      drawSpectrum(wl, hl);
      break;
    case 'lissajous':
      drawLissajous(wl, hl);
      break;
    case 'radial':
      drawRadial(wl, hl, now);
      break;
    case 'waterfall':
      drawWaterfall(wl, hl);
      break;
    case 'particle':
      drawParticles(wl, hl);
      break;
    case 'pixel_map':
      drawScope(wl, hl);
      drawPixelMap(wl, hl);
      break;
    case 'scope':
    default:
      drawScope(wl, hl);
      break;
  }

  if (
    params.pixelMap &&
    mode !== 'pixel_map'
  ) {
    drawPixelMap(wl, hl);
  }

  ctx.restore();
}

function prepareStroke(width: number) {
  if (!ctx) {
    return;
  }

  ctx.strokeStyle = accent;
  ctx.lineWidth = width * params.beam;
  ctx.globalAlpha = Math.min(1, 0.48 + params.intensity * 0.42);
  ctx.shadowBlur = glow(12);
  ctx.shadowColor = accent;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function drawScope(w: number, h: number) {
  if (!ctx) {
    return;
  }

  prepareStroke(1.25);
  ctx.beginPath();

  const step =
    Math.max(1, params.sampleStep);

  for (let i = 0; i < timeData.length; i += step) {
    const x =
      (i / (timeData.length - 1)) * w;

    const v =
      ((getTime(i) / 128) - 1) *
      params.yScale *
      0.42;

    const y =
      h / 2 +
      v * h;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawSpectrum(w: number, h: number) {
  if (!ctx) {
    return;
  }

  const step =
    Math.max(2, params.sampleStep * 2);

  const bins =
    Math.floor(freqData.length * 0.62);

  const count =
    Math.max(12, Math.floor(bins / step));

  const barW =
    w / count;

  ctx.shadowBlur = glow(8);
  ctx.shadowColor = accent;

  for (let i = 0; i < count; i++) {
    const v =
      getFreq(i * step) / 255;

    const barH =
      v * h * 0.78 * params.yScale;

    ctx.fillStyle =
      cssAlpha(accent, 0.22 + v * 0.68 * params.intensity);

    ctx.fillRect(
      i * barW,
      h - barH,
      Math.max(1, barW - 1),
      barH
    );
  }

  ctx.shadowBlur = 0;
}

function drawLissajous(w: number, h: number) {
  if (!ctx) {
    return;
  }

  prepareStroke(1.1);
  ctx.beginPath();

  const length =
    running
      ? Math.min(
        lissajousXData.length,
        lissajousYData.length
      )
      : LISS_LEN;

  const step =
    Math.max(
      1,
      params.sampleStep,
      Math.ceil(length / LISS_MAX_POINTS)
    );

  for (let i = 0; i < length; i += step) {
    const phase =
      i / Math.max(1, length - 1);

    const xValue =
      running
        ? ((lissajousXData[i] ?? 128) - 128) / 128
        : Math.sin(phase * Math.PI * 2 + demoT);

    const yValue =
      running
        ? ((lissajousYData[i] ?? 128) - 128) / 128
        : Math.sin(phase * Math.PI * 2 + demoT + Math.PI / 2);

    const x =
      w / 2 +
      xValue *
      params.xScale *
      w *
      0.38;

    const y =
      h / 2 +
      yValue *
      params.yScale *
      h *
      -0.38;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawRadial(w: number, h: number, now: number) {
  if (!ctx) {
    return;
  }

  const cx = w / 2;
  const cy = h / 2;
  const base = Math.min(w, h) * 0.22 * params.xScale;
  const step = Math.max(2, params.sampleStep);

  prepareStroke(1.15);
  ctx.beginPath();

  for (let i = 0; i < timeData.length; i += step) {
    const t =
      i / timeData.length;

    const a =
      t * Math.PI * 2 + now * 0.00018;

    const v =
      ((getTime(i) / 128) - 1) *
      Math.min(w, h) *
      0.18 *
      params.yScale;

    const r =
      base + v;

    const x =
      cx + Math.cos(a) * r;

    const y =
      cy + Math.sin(a) * r;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawWaterfall(w: number, h: number) {
  if (!ctx) {
    return;
  }

  ensureWaterfall();

  const row =
    waterfallPool[waterfallWrite];

  for (let i = 0; i < row.length; i++) {
    row[i] =
      getFreq(i);
  }

  waterfallWrite =
    (waterfallWrite + 1) % WATERFALL_ROWS;

  const rowH =
    Math.max(2, h / WATERFALL_ROWS);

  const step =
    Math.max(1, params.sampleStep);

  for (let y = 0; y < WATERFALL_ROWS; y++) {
    const idx =
      (waterfallWrite - 1 - y + WATERFALL_ROWS) % WATERFALL_ROWS;

    const data =
      waterfallPool[idx];

    const bins =
      Math.floor(data.length * 0.58);

    const cellW =
      w / Math.ceil(bins / step);

    for (let i = 0; i < bins; i += step) {
      const v =
        data[i] / 255;

      if (v < 0.03) {
        continue;
      }

      ctx.fillStyle =
        cssAlpha(accent, v * 0.7 * params.intensity);

      ctx.fillRect(
        (i / step) * cellW,
        y * rowH,
        Math.ceil(cellW),
        Math.ceil(rowH)
      );
    }
  }
}

function drawParticles(w: number, h: number) {
  if (!ctx) {
    return;
  }

  const energy =
    getFreq(4) / 255;

  ctx.fillStyle =
    cssAlpha(accent, 0.25 + energy * 0.55);

  ctx.shadowBlur =
    glow(10);

  ctx.shadowColor =
    accent;

  for (let i = 0; i < PARTICLES; i++) {
    particleY[i] -= particleV[i] * (0.35 + energy);

    if (particleY[i] < -0.05) {
      particleY[i] = 1.05;
      particleX[i] = Math.random();
    }

    const size =
      1 + energy * 5 * params.beam;

    ctx.fillRect(
      particleX[i] * w,
      particleY[i] * h,
      size,
      size
    );
  }

  ctx.shadowBlur = 0;
}

function drawPixelMap(w: number, h: number) {
  if (!ctx) {
    return;
  }

  const cols = 56;
  const rows = 24;
  const cw = w / cols;
  const ch = h / rows;

  ctx.shadowBlur = 0;

  for (let x = 0; x < cols; x++) {
    const sample =
      Math.floor((x / cols) * (timeData.length - 1));

    const v =
      Math.abs((getTime(sample) / 128) - 1);

    const height =
      Math.floor(v * rows * params.yScale);

    for (let y = 0; y < height; y++) {
      const alpha =
        Math.max(0.06, (1 - y / rows) * 0.38 * params.intensity);

      ctx.fillStyle =
        cssAlpha(accent, alpha);

      ctx.fillRect(
        x * cw + 1,
        h / 2 - y * ch,
        Math.max(1, cw - 2),
        Math.max(1, ch - 2)
      );

      ctx.fillRect(
        x * cw + 1,
        h / 2 + y * ch,
        Math.max(1, cw - 2),
        Math.max(1, ch - 2)
      );
    }
  }
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const message =
    event.data;

  if (message.type === 'init') {
    canvas =
      message.canvas;

    ctx =
      canvas.getContext('2d');

    accent =
      message.color;

    if (message.sab) {
      const timeLength =
        message.timeLength ?? 2048;

      const freqLength =
        message.freqLength ?? 2048;

      sabTime =
        new Uint8Array(
          message.sab,
          0,
          timeLength
        );

      sabFreq =
        new Uint8Array(
          message.sab,
          timeLength,
          freqLength
        );

      timeData =
        sabTime;

      freqData =
        sabFreq;
    }

    initParticles();
    ensureWaterfall();
    self.postMessage({
      type: 'ready'
    });
    loop();
    return;
  }

  if (message.type === 'resize') {
    params.width =
      message.width;

    params.height =
      message.height;

    params.dpr =
      message.dpr;

    if (canvas) {
      canvas.width =
        message.width;

      canvas.height =
        message.height;
    }

    return;
  }

  if (message.type === 'color') {
    accent =
      message.value;

    return;
  }

  if (message.type === 'frame') {
    mode =
      message.mode;

    params =
      message.params;

    targetFps =
      params.targetFps;

    running =
      message.running;

    if (
      !sabTime &&
      message.timeData
    ) {
      timeData =
        message.timeData;
    }

    if (
      !sabFreq &&
      message.freqData
    ) {
      freqData =
        message.freqData;
    }

    if (message.lissajousXData) {
      lissajousXData =
        message.lissajousXData;
    }

    if (message.lissajousYData) {
      lissajousYData =
        message.lissajousYData;
    }
  }
};
