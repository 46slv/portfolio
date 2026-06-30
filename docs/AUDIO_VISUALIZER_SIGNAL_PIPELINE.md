# Audio Visualizer Signal Pipeline

Date: 2026-06-30

## Purpose

This note records a reusable calculation strategy for the whole audio visualizer, not only Lissajous mode.

Target:

- Keep raw waveform modes correct.
- Keep FHD 60p realistic.
- Allow future modes to be added without duplicating audio capture, FFT, channel splitting, RMS, and decimation logic.
- Keep mode-specific code focused on rendering, not audio graph ownership.

## Current Project Context

- Page: `src/pages/visualizer.astro`
- UI and main-thread fallback: `src/components/Visualizer.astro`
- Worker renderer: `src/scripts/visualizer-worker.ts`
- Audio graph: `src/lib/audio/AudioEngine.ts`
- Current modes:
  - `scope`
  - `spectrum`
  - `lissajous`
  - `radial`
  - `waterfall`
  - `particle`
  - `pixel_map`

Current risk:

- Each mode can slowly grow its own assumptions about time data, frequency data, stereo data, scale, smoothing, and point count.
- That makes it harder to add modes while keeping performance and correctness predictable.

## Sources

### MDN: AnalyserNode

URL: https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode

Implementation reading:

- `AnalyserNode` is the built-in Web Audio API node for time-domain and frequency-domain analysis.
- It exposes `fftSize`, `frequencyBinCount`, `minDecibels`, `maxDecibels`, and `smoothingTimeConstant`.
- This project should centralize analyser configuration instead of letting each mode define analysis behavior independently.

### MDN: getFloatTimeDomainData

URL: https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData

Implementation reading:

- Float time-domain data is already normalized around `[-1, 1]`.
- It is better for reusable geometry calculations than byte data when precision matters.
- Byte data remains acceptable for lightweight rendering, but the internal normalized representation should be conceptually float-like.

### MDN: getFloatFrequencyData

URL: https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatFrequencyData

Implementation reading:

- Float frequency data is copied into a caller-provided `Float32Array`.
- Frequency bins are linear from 0 to half the sample rate.
- MDN notes that byte frequency data is a higher-performance option when precision is less important.
- For this project, use byte data for high-FPS visual modes by default, and reserve float frequency data for future precision modes or offline analysis.

### MDN: ChannelSplitterNode

URL: https://developer.mozilla.org/en-US/docs/Web/API/ChannelSplitterNode

Implementation reading:

- Stereo-dependent modes should share one channel split in the audio graph.
- Left/right analysis should be a first-class data product, not special logic inside Lissajous rendering.

### MDN: AudioWorklet

URL: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet

Implementation reading:

- `AudioWorklet` runs custom audio processing in a separate Web Audio thread and is intended for low-latency audio work.
- It is a future option if `AnalyserNode` snapshots become too limiting.
- It should not be the first implementation step because the current visualizer can stay simpler with `AnalyserNode`.

### MDN: AudioWorkletProcessor.process()

URL: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process

Implementation reading:

- `process()` receives channel sample arrays, currently in 128-frame blocks, but code should check actual block length rather than hard-coding it.
- Samples are `Float32Array` values in `[-1, 1]`.
- If this project later needs precise sample windows, rolling RMS, peak hold, onset detection, or beat/onset data, an AudioWorklet can maintain a shared ring buffer of float samples.

### MDN: Transferable Objects

URL: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects

Implementation reading:

- `ArrayBuffer` can be transferred between threads without copying, but the sender loses access after transfer.
- Transferring per-frame arrays is awkward for a continuously reused render buffer unless double/triple buffering is introduced.
- For this visualizer, prefer reusable arrays and small payloads first; consider transferable buffers only if profiling shows postMessage copies are the bottleneck.

### MDN: SharedArrayBuffer

URL: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer

Implementation reading:

- `SharedArrayBuffer` allows memory to be visible to multiple agents.
- It is useful for high-throughput producer/consumer patterns, such as audio capture to render worker.
- It carries deployment constraints around cross-origin isolation, so it should be optional rather than required for the baseline site.

### MDN: AudioBuffer.getChannelData

URL: https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer/getChannelData

Implementation reading:

- Decoded audio files expose channel data as `Float32Array`.
- If a future visualizer mode supports loaded audio files or precomputed waveform previews, it should use the same normalized channel-frame model as the live pipeline.

### MDN: OfflineAudioContext

URL: https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext

Implementation reading:

- Offline rendering can process audio as fast as possible without realtime output.
- This is useful for future file-based waveform thumbnails, waveform pyramids, loudness scans, or beat markers.
- It is not needed for microphone/live 60p rendering.

## Proposed Architecture

Use a four-layer pipeline:

```text
Audio Source
  -> Analysis Capture
  -> Visual Frame Snapshot
  -> Mode Renderer
```

### 1. Audio Source

Owns browser audio nodes and permissions:

- microphone stream
- optional media element or loaded file source later
- monitor gain/output
- filters/effects if intentionally part of the visualized signal
- channel splitter
- shared analysers

Modes must not create or reconfigure audio graph nodes directly.

### 2. Analysis Capture

Produces reusable low-level arrays:

```ts
interface AudioAnalysisBuffers {
  monoTime: Uint8Array | Float32Array;
  leftTime: Uint8Array | Float32Array;
  rightTime: Uint8Array | Float32Array;
  frequency: Uint8Array | Float32Array;
}
```

Rules:

- Buffers are allocated once and reused.
- `fftSize` and smoothing live in one place.
- Left/right analyser settings stay identical.
- Frequency arrays are filled only when the active mode needs them.
- Stereo arrays are filled only when the active mode needs stereo.

### 3. Visual Frame Snapshot

Converts raw analyser buffers into mode-agnostic features.

Recommended snapshot:

```ts
interface AudioFrameSnapshot {
  frameId: number;
  sampleRate: number;
  timestampMs: number;
  running: boolean;
  time?: WaveformView;
  stereo?: StereoWaveformView;
  spectrum?: SpectrumView;
  levels?: LevelMetrics;
}

interface WaveformView {
  data: Uint8Array | Float32Array;
  center: number;
  scale: number;
  length: number;
}

interface StereoWaveformView {
  left: Uint8Array | Float32Array;
  right: Uint8Array | Float32Array;
  center: number;
  scale: number;
  length: number;
  monoFallback: boolean;
}

interface SpectrumView {
  data: Uint8Array | Float32Array;
  binCount: number;
  minHz: number;
  maxHz: number;
  minDb?: number;
  maxDb?: number;
}

interface LevelMetrics {
  rms: number;
  peak: number;
  stereoCorrelation?: number;
  stereoWidth?: number;
}
```

For byte time-domain data:

```text
normalized = (sample - 128) / 128
center = 128
scale = 128
```

For float time-domain data:

```text
normalized = sample
center = 0
scale = 1
```

Renderers should call a shared helper rather than knowing byte-vs-float details:

```ts
function readNormalized(view, index) {
  return (view.data[index] - view.center) / view.scale;
}
```

### 4. Mode Renderer

Each mode declares what data it needs:

```ts
type AnalysisNeed =
  | 'monoTime'
  | 'stereoTime'
  | 'frequency'
  | 'levels'
  | 'history';

interface VisualModeDefinition {
  id: VizMode;
  needs: AnalysisNeed[];
  maxPoints: number;
  draw(ctx, frame, params): void;
}
```

Mode requirements:

| Mode | Required data | Optional data | Notes |
| --- | --- | --- | --- |
| `scope` | `monoTime` | `levels` | X is sample position, Y is amplitude |
| `lissajous` | `stereoTime` | `levels` | X is left, Y is right; raw XY orientation |
| `spectrum` | `frequency` | `levels` | frequency bins only |
| `waterfall` | `frequency` | `history` | history should be managed by renderer/worker |
| `radial` | `monoTime` or `frequency` | `levels` | define mode contract before changing |
| `particle` | `levels` + optional `frequency` | `history` | particles should not force all modes to compute FFT |
| `pixel_map` | `frequency` or downsampled bands | `levels` | use reduced bands, not full bins, if possible |

## Shared Calculations To Centralize

### Normalization

Centralize byte/float normalization:

```text
byte time: (v - 128) / 128
float time: v
byte frequency: v / 255
float frequency: normalize dB from minDb..maxDb to 0..1
```

### Decimation

All geometry renderers should use a shared point-budget helper:

```text
step = max(1, ceil(inputLength / maxPoints))
```

This makes FHD 60p predictable when modes change.

### Resampling / Bands

Frequency modes should not draw all FFT bins by default. Use reusable band reducers:

```text
linearBands(input, bandCount)
logBands(input, bandCount, sampleRate)
peakBands(input, bandCount)
averageBands(input, bandCount)
```

Recommended:

- `spectrum`: 128 to 256 visible bars.
- `pixel_map`: 32 to 96 bands.
- `waterfall`: 96 to 192 columns unless high quality is explicitly selected.

### Level Metrics

Compute once per frame when needed:

```text
rms = sqrt(sum(sample^2) / n)
peak = max(abs(sample))
```

Stereo-specific metrics:

```text
mid = (left + right) * 0.5
side = (left - right) * 0.5
stereoWidth = rms(side) / max(epsilon, rms(mid))
correlation = sum(left * right) / sqrt(sum(left^2) * sum(right^2))
```

These support future modes without forcing them to inspect raw arrays.

### History

History should live in renderer/worker state, not in `AudioEngine`.

Examples:

- waterfall row ring buffer
- particle state arrays
- peak hold values
- afterglow/persistence canvas state

Audio capture should provide the current frame; renderers decide how to remember past frames.

## FHD 60p Baseline

Recommended baseline for live modes:

```text
targetFps: 60
internal render cap: 1920x1080 before DPR multiplication gets too expensive
time fftSize: 2048
frequency fftSize: 2048 or 4096 only when frequency mode is active
scope max points: 1024
lissajous max points: 768-1024
spectrum bands: 128-192
waterfall columns: 128
particle count: 128-256
per-frame allocations: none in hot path
worker rendering: preferred
frequency data in non-frequency modes: no
```

Do not treat FHD 60p as "draw every available sample at full DPR". Treat it as "render a stable visual representation at 60 frames per second within a fixed point budget".

## Data Transport Strategy

### Baseline

- Main thread owns Web Audio and fills reusable buffers.
- Worker owns `OffscreenCanvas` and mode history.
- Per frame, send only data required by current mode.
- Keep payload shape mode-specific but derived from the shared snapshot.

### Higher Performance Option

If profiling shows copies are expensive:

- Introduce double-buffered transferable `ArrayBuffer` for active data views.
- Or introduce `SharedArrayBuffer` ring buffers when deployment can satisfy cross-origin isolation.

Do not start with SharedArrayBuffer as a hard requirement because it complicates static-site deployment.

## Future Mode Contract

Before adding a mode, answer:

- Does it need time-domain, stereo time-domain, frequency-domain, level metrics, or history?
- What maximum points/bands/particles does it draw at FHD 60p?
- Does it need byte precision or float precision?
- Does it mutate audio graph settings?
- Can it run from the same `AudioFrameSnapshot` as existing modes?
- What should happen when microphone input is mono or silent?

If a mode needs a new analysis product, add it to the shared snapshot rather than calculating it privately inside the renderer.

## Recommended Next Implementation Step

Do this before adding more modes:

1. Introduce a small `AudioFrameSnapshot` type near the visualizer code.
2. Add a mode-to-analysis-needs map.
3. Fill only the required buffers for the active mode.
4. Add shared helpers:
   - `readNormalizedTime()`
   - `computePointStep()`
   - `computeRmsPeak()`
   - `reduceLinearBands()`
5. Update worker frame messages to carry `frame` fields instead of unrelated optional arrays.

This is a small architecture correction, not a full rewrite.
