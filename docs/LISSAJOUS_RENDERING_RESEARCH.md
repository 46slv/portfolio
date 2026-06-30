# Lissajous Rendering Research

Date: 2026-06-30

## Purpose

This note collects reference material and implementation rules for fixing the `/visualizer` Lissajous mode.

Current problem statement: the displayed Lissajous shape is not always the physically correct shape. The fix should treat the mode as an XY oscilloscope display, not as a decorative waveform effect.

## Project Context

- Project: Astro portfolio site.
- Target page: `src/pages/visualizer.astro`.
- Main visual component: `src/components/Visualizer.astro`.
- Worker renderer: `src/scripts/visualizer-worker.ts`.
- Audio source and analysers: `src/lib/audio/AudioEngine.ts`.
- Existing project note already states: Lissajous should use left-channel time-domain samples for X and right-channel time-domain samples for Y.

No destructive change is required for this research step.

## Sources

### CQ Publishing: Oscilloscope Lissajous Basics

URL: https://www.cqpub.co.jp/column/books/2001a/11891osiro/oscillo7.htm

Key points:

- A Lissajous figure is drawn by feeding sine-wave AC signals into both oscilloscope axes at the same time.
- The screen pattern changes according to frequency, phase, and amplitude relationships between the two signals.
- In the example where Y receives 2 kHz and X receives 1 kHz, the displayed figure is a 1:2 frequency-ratio figure when amplitude and phase are equal.
- For equal-frequency 1:1 signals, phase difference changes the figure from a sloped line to an ellipse or circle-like shape.

Implementation reading:

- The X coordinate must come from one signal and the Y coordinate from another signal at the same sample time.
- A synthetic time sweep on X is not a Lissajous display.
- A fake phase offset applied to a mono waveform is a demo animation, not a measurement-style stereo Lissajous display.

### Tektronix: Oscilloscope XY Display

URL: https://www.tek.com/en/support/faqs/how-do-i-utilize-xy-display-feature-dpo-mso-mdo4000-series-oscilloscope

Key points:

- XY display measures the phase relationship between synchronous signals.
- One signal drives the vertical system and another signal drives the horizontal system.
- Both axes trace voltages; the resulting display is the Lissajous pattern.

Implementation reading:

- The renderer should plot voltage-like sample amplitude on both axes.
- For this visualizer, normalized PCM amplitude is the voltage equivalent.
- Horizontal position must not be sample index when mode is `lissajous`; sample index is only the iteration variable.

### Wikipedia Japanese: Lissajous Figure

URL: https://ja.wikipedia.org/wiki/%E3%83%AA%E3%82%B5%E3%82%B8%E3%83%A5%E3%83%BC%E5%9B%B3%E5%BD%A2

Useful equation shown on the page:

```text
x = A * cos(a * t)
y = B * sin(b * t + delta)
```

Key points:

- A Lissajous curve is a plane figure produced by combining two mutually perpendicular simple harmonic motions.
- `A` and `B` control the width and height.
- `a:b` controls the frequency ratio and the number of lobes.
- `delta` controls the phase relation.
- Rational frequency ratios produce closed figures; irrational or drifting ratios do not settle into a closed figure.
- An oscilloscope in X-Y input mode can observe this kind of waveform by feeding `x` and `y` into the two inputs.
- The page explicitly connects visible vertical/horizontal lobes to the frequency ratio between the reference wave and measured wave.
- At 1:1 frequency ratio:
  - 0 or 180 degrees phase difference gives a line.
  - 90 degrees phase difference with equal amplitudes gives a circle.
  - Other phase differences give ellipses.

Implementation reading:

- A correct live stereo display does not need to estimate `a`, `b`, or `delta`; it simply plots simultaneous X/Y samples.
- A deterministic demo mode can use the equation above to generate known reference shapes.
- If the shape is wrong for test tones, inspect channel routing, normalization, axis inversion, and sampling window before changing styling.

### Cadence: Reading Lissajous Curves

URL: https://resources.pcb.cadence.com/blog/how-to-read-lissajous-curves-on-oscilloscopes

Key points:

- Shape depends on relative amplitude, frequencies, and phase difference.
- Integer frequency ratios produce characteristic loop patterns.

Implementation reading:

- Visual controls named `xScale` and `yScale` should only scale amplitude; they must not alter the underlying signal relationship.
- Smoothing, decay, glow, and interpolation can make the visual nicer, but they must not change the coordinate mapping.

### g200kg: DTM Dictionary Lissajous Entry

URL: https://www.g200kg.com/jp/docs/dic/lissajous.html

Key points:

- In audio contexts, Lissajous displays are used to understand phase difference and stereo width.
- Related names include Lissajous meter, phase meter, phase scope, and XY meter.
- For stereo audio monitoring, the stereo R and L signals are fed to the X and Y axes.
- A mono signal produces a 45 degree straight line because the X and Y movement is the same.
- The portion that deviates from the 45 degree line can be read as stereo width.
- Some stereo Lissajous meters rotate the display 45 degrees so a center-panned sound appears as a vertical line.

Implementation reading:

- This source directly supports using real left/right audio channels for live Lissajous mode.
- Mono or effectively mono input should not be turned into a circle by adding a fake phase offset. It should become a diagonal line in raw XY mode.
- A 45 degree rotated "phase scope" presentation is a valid audio-meter variant, but it is a display transform. It should be explicit and documented, not mixed into the base coordinate mapping.
- Decision for this project: do not rotate the display just to make center-panned mono appear vertical. Use raw XY oscilloscope orientation as the baseline.

### MDN: Web Audio Time-Domain Data

URL: https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getByteTimeDomainData

Key points:

- `getByteTimeDomainData()` copies the current waveform/time-domain data into a `Uint8Array`.
- Values are byte waveform samples suitable for oscilloscope-style drawing.

Implementation reading:

- `Uint8Array` value `128` should be treated as center/silence for byte time-domain data.
- Normalization should be:

```text
normalized = (sample - 128) / 128
```

- For better precision later, `getFloatTimeDomainData()` can avoid byte quantization, but this is not required for a first correction.

### MDN: ChannelSplitterNode

URL: https://developer.mozilla.org/en-US/docs/Web/API/ChannelSplitterNode

Key points:

- `ChannelSplitterNode` separates different channels of an audio source into mono outputs.
- It is useful when channels need separate processing.

Implementation reading:

- Lissajous requires separate left and right time-domain streams.
- A single analyser on a mixed stereo stream is insufficient because it can collapse the stereo relation.
- The expected graph is source -> splitter -> left analyser and right analyser.

## Correct Rendering Model

For every rendered sample pair:

```text
xSignal = normalize(leftTimeDomain[i])
ySignal = normalize(rightTimeDomain[i])

x = centerX + xSignal * xAmplitudeScale
y = centerY - ySignal * yAmplitudeScale
```

Notes:

- The minus sign on Y is recommended because canvas Y grows downward while oscilloscope voltage normally grows upward.
- Project decision: use upward-positive Y for Lissajous by applying the minus sign in both worker and fallback renderers.
- The iteration index `i` only selects simultaneous sample pairs. It must not be used as horizontal position in Lissajous mode.
- `sampleStep` may decimate points for performance, but it must step both channels by the same amount.
- Both arrays must represent the same capture window and analyser settings.
- Project decision: do not apply the visualizer's global rotation knob to Lissajous mode. Raw XY axes stay fixed.

## Expected Reference Shapes

Use generated test tones or deterministic demo data:

| X signal | Y signal | Expected figure |
| --- | --- | --- |
| `sin(t)` | `sin(t)` | Rising or falling diagonal line, depending Y inversion/sign convention |
| `sin(t)` | `-sin(t)` | Opposite diagonal line |
| `sin(t)` | `sin(t + pi / 2)` | Circle if amplitudes match |
| `sin(t)` | `0.5 * sin(t + pi / 2)` | Ellipse |
| `sin(t)` | `sin(2t)` | 1:2 two-lobed figure |
| mono duplicated to both channels | same as X | Diagonal line, not a circle |
| right channel silent | duplicated left fallback, if adopted | Diagonal line |

For a 45 degree rotated phase-scope view, if it is ever added later:

| Input relation | Expected figure |
| --- | --- |
| mono / center-panned | Vertical center line |
| wide stereo difference | Wider horizontal spread |

This rotated view is out of scope for the current correction and should be considered a separate presentation mode from raw XY Lissajous.

## Current-Code Risk Areas

Observed files to inspect before changing behavior:

- `src/lib/audio/AudioEngine.ts`
  - Confirm the stereo splitter is actually receiving stereo input.
  - Confirm left and right analysers have the same `fftSize`, smoothing, and timing.
  - Confirm mono/right-silent fallback does not hide real phase information.
- `src/scripts/visualizer-worker.ts`
  - Lissajous drawing currently maps X/Y from `lissajousXData` and `lissajousYData`; verify Y sign and sample window correctness.
  - Demo mode uses a 90 degree offset, which is valid only as a synthetic reference/demo.
- `src/components/Visualizer.astro`
  - Main-thread fallback should match worker geometry exactly.
  - Any UI controls for motion, speed, phase, or shaping must not secretly alter real stereo sample coordinates.

## Proposed Fix Direction

1. Add a deterministic Lissajous test generator or temporary debug mode with known `sin()` pairs.
2. Verify worker and main-thread fallback produce the same reference shapes.
3. Confirm live audio graph uses a channel splitter and two analysers, not a downmixed analyser.
4. Invert canvas Y for oscilloscope convention unless existing visual direction is intentionally preserved and documented.
5. Do not add synthetic phase offset to live mono input. For mono, duplicate X to Y or show a documented mono state.
6. Use raw XY oscilloscope orientation. Do not rotate the display to make mono or center-panned material vertical.
7. Keep style-only effects separate from geometry:
   - allowed: beam width, glow, persistence/decay, opacity
   - risky: point reordering, X time sweep, unequal smoothing, artificial phase, nonlinear amplitude warping

## Lightweight Implementation Research

Goal: keep the Lissajous mode correct while reducing CPU, memory traffic, and main-thread work.

### MDN: Canvas Optimization

URL: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas

Key points:

- Repeated drawing work can be pre-rendered or moved to an offscreen canvas.
- Avoid unnecessary sub-pixel work where possible.
- Avoid unnecessary scaling work during every draw.

Implementation reading:

- The Lissajous trace itself changes every frame, so the path cannot be cached like a static sprite.
- Static background elements, grids, labels, and glow backplates should not be redrawn expensively on every frame if they are added later.
- Keep the Lissajous renderer minimal: one `beginPath()`, one loop, one `stroke()`.
- Avoid expensive per-point style changes. Stroke style, alpha, shadow, and line width should be set once per frame.

### MDN: OffscreenCanvas

URL: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas

Key points:

- `OffscreenCanvas` decouples Canvas rendering from the DOM.
- Rendering can run in a worker, which helps avoid heavy rendering work on the main thread.
- `OffscreenCanvas` is transferable.

Implementation reading:

- The existing worker renderer is the right direction for full-screen visualizer rendering.
- Keep a main-thread fallback, but do not optimize the fallback at the expense of the worker path.
- After transferring a canvas, the main thread should not assume it can recover that same canvas for normal 2D drawing unless the fallback path is explicitly designed.

### web.dev: OffscreenCanvas

URL: https://web.dev/articles/offscreen-canvas

Key points:

- OffscreenCanvas can keep animation smoother when the main thread is busy.
- It is best used as a progressive enhancement.
- Worker-based rendering has DOM API limitations, so the worker should receive plain data and simple parameters.

Implementation reading:

- Send only the arrays and parameters needed by the active mode.
- For Lissajous, frame payload should include only:
  - left time-domain byte array
  - right time-domain byte array
  - scale/beam/glow/decay/color parameters
  - canvas size and DPR when changed
- Do not send frequency data to Lissajous mode.
- Avoid sending large UI state objects every frame.

### MDN: requestAnimationFrame

URL: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame

Key points:

- `requestAnimationFrame()` asks the browser to call animation code before the next repaint.
- It is the browser-aligned mechanism for visual animation.

Implementation reading:

- Use `requestAnimationFrame` as the render clock where available.
- Limit the actual draw work to the target FPS by checking elapsed time inside the rAF loop.
- Pause or greatly reduce rendering when the visualizer is stopped, hidden, or not running.
- Avoid `setTimeout(..., 0)` render polling.

### MDN: AnalyserNode Time-Domain Data

URL: https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getByteTimeDomainData

Key points:

- `getByteTimeDomainData()` copies the current waveform into a supplied `Uint8Array`.
- The caller provides the array, so it can be reused.

Implementation reading:

- Reuse preallocated `Uint8Array` buffers for left and right data.
- Do not allocate new arrays every frame in the render loop.
- Use the smallest analyser `fftSize` that still gives a stable-looking figure.
- Lissajous does not require frequency-domain data.

### MDN: ChannelSplitterNode

URL: https://developer.mozilla.org/en-US/docs/Web/API/ChannelSplitterNode

Key points:

- `ChannelSplitterNode` separates source channels into mono outputs.

Implementation reading:

- Use a splitter once in the audio graph, not per frame.
- Keep left and right analyser settings identical.
- Do not create/destroy analyser nodes during mode switching.

### MDN: Canvas lineTo

URL: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/lineTo

Key points:

- `lineTo()` adds a straight segment from the current point to a new `(x, y)` coordinate.

Implementation reading:

- Lissajous can be drawn as a single polyline path.
- Performance cost scales with point count, so point count is the main knob.
- Use `sampleStep` or a computed stride to keep the maximum plotted points bounded.

### MDN: globalCompositeOperation

URL: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation

Key points:

- `globalCompositeOperation` controls how new drawing is composited with existing canvas content.

Implementation reading:

- Persistence/decay effects can be done by drawing a translucent fade over the previous frame, then drawing the new trace.
- This can be cheaper than redrawing complex history trails.
- Keep the default composite mode simple unless a specific glow/trail effect requires otherwise.

## Lightweight Implementation Plan

### Minimal Correction

- Keep current Canvas 2D renderer and worker structure.
- Confirm Lissajous uses left/right arrays only.
- Use raw XY orientation, with no 45 degree rotation.
- Normalize bytes with `(sample - 128) / 128`.
- Draw one path per frame.
- Do not allocate arrays inside the per-frame Lissajous drawing function.
- Bound plotted points, for example:

```text
maxPoints = 512 to 1024
step = ceil(length / maxPoints)
```

This keeps CPU predictable even if analyser `fftSize` grows.

### Robust Lightweight Version

- Add a mode-specific frame payload contract:
  - `scope`: time-domain mono/mixed data
  - `lissajous`: left/right time-domain data only
  - frequency modes: frequency data only
- Keep worker draw scheduling interval-aware.
- Reuse left/right buffers.
- Add a developer-only deterministic test-tone path for shape verification.
- Add a debug flag or code path to force main-thread fallback for visual comparison.

### Avoid For Now

- Do not move Lissajous to WebGL unless Canvas 2D profiling proves insufficient.
- Do not add Path2D caching for live Lissajous; the path changes every frame, so cache benefit is limited.
- Do not add smoothing that changes left/right timing differently.
- Do not add visual interpolation before verifying correct raw shape.
- Do not add 45 degree phase-scope rotation in this correction.

## Performance Budget Recommendation

Recommended default for this project:

```text
target FPS: 30
render scale: 0.75 on high-DPR/fullscreen
max Lissajous points: 512-1024
arrays per frame: reuse existing buffers
worker payload: only active mode data
frequency data in Lissajous mode: no
main-thread fallback: same geometry, lower priority
```

Rationale:

- Correct L/R XY mapping is independent of drawing all available samples.
- Decimating simultaneous pairs preserves the geometric relation better than adding smoothing or fake phase.
- 30 FPS is enough for a music visualizer trace and reduces battery/CPU pressure.
- Worker rendering keeps UI controls responsive.

2026-06-30 update:

- The broader target is FHD 60p when practical.
- FHD 60p should be pursued with a fixed point budget, worker rendering, mode-specific analysis payloads, and no per-frame hot-path allocation.
- See `docs/AUDIO_VISUALIZER_SIGNAL_PIPELINE.md` for the reusable calculation model intended to support future visualizer modes.

Implemented correction:

- Worker and main-thread fallback now render Lissajous with upward-positive Y.
- Lissajous rendering ignores global visual rotation so raw XY orientation remains correct.
- Lissajous plotting is capped through a `1024` point budget plus the user's sample-step setting.
- A browser-generated test tone path is available for Lissajous verification:
  - `mono`: same sine tone on L/R, expected diagonal line.
  - `phase90`: same frequency with right channel delayed by 90 degrees, expected circle or ellipse depending display aspect and scale.
  - `ratio12`: left base frequency and right double frequency, expected 1:2 Lissajous figure.
- Test tones feed the same audio graph and analysers as microphone input. Audibility follows the existing Monitor control so test playback does not force output volume on.

## Implementation Constraints

- This is a browser/Astro TypeScript codebase, not After Effects ExtendScript.
- No file-format migration is expected.
- No saved user data compatibility issue is expected.
- Risk is visual behavior regression in `/visualizer`, especially worker/fallback mismatch and mobile performance.

## Verification Plan

Minimum checks after implementation:

1. `npm run build`
2. Browser smoke test `/visualizer`
3. Compare worker and fallback output if there is a way to force fallback.
4. Test deterministic reference pairs:
   - in-phase 1:1 line
   - 90 degree 1:1 circle/ellipse
   - 1:2 figure
   - mono duplicated input diagonal
5. Confirm controls do not change topology of the Lissajous figure except through documented X/Y scale.

## Open Questions Before Code Changes

- Should the visualizer follow oscilloscope convention and invert Y upward-positive, even if the current visual appears vertically mirrored?
- Should mono input be shown as a diagonal line, or should the UI explicitly label it as mono/right-silent?
- Do we need a persistent debug/test-tone mode in the UI, or is a developer-only helper enough?
