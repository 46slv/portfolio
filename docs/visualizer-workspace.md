# Audio shape workspace

## Scope

A lightweight waveform/stereo inspection tool that also supports large visual
presentation. This replaces the old visualizer's heavy overlay and overlapping
render loops, not the unrelated home glyph/readability work. No framework change,
file playback, export, AudioWorklet, SharedArrayBuffer or WebGL is introduced.

## Interaction

- Start demo is silent and does not create an AudioContext or request microphone access.
- Use microphone is an explicit user gesture. Stop remains available while permission
  is pending; a late result is released rather than resurrecting capture.
- The monitor starts exactly muted, resets to mute on source changes/Stop, and is
  disabled outside live microphone input. Display gain never changes the audio graph.
- Hidden pages stop pending/live microphone capture for privacy and explain how to
  restart. Demo pauses its visible clock and resumes without a background-time jump.
- OSC, Spectrum and XY are primary. Secondary presentation modes are optional.
  Controls without meaning for a mode are hidden. There is no global Tab or wheel hijack.
- Focus view hides chrome and offers an explicit Exit focus button and Escape.
  Fullscreen is separate and failures are reported. Mobile uses document scrolling.
- Reset restores view/appearance defaults without starting or switching a source.

## Module ownership

- `model.ts`: typed mode registry, analysis needs, valid controls and quality budgets.
- `analysis.ts`: RMS/correlation, paired decimation, deterministic demo PCM and bounded
  logarithmic frequency aggregation. Demo frequency magnitudes are idealized, not an
  FFT measurement or a hardware calibration. Mono analysis is the L/R average in demo
  and in the real analyser's mono downmix, so antiphase cancellation is intentional.
- `AudioEngine.ts`: raw MediaStream → analysers / exactly-muted sink / monitor.
  No wave shaper, low/high-pass filter, delay or near-silent keepalive path remains.
  FFT is applied at engine construction and reapplied with a quality change.
- `SourceController.ts`: explicit source state and asynchronous generation ownership.
- `FramePump.ts`: one deadline-controlled producer; one reserved in-flight slot.
  Stale ACKs cannot count as current output or release a newer frame's reservation.
- `Renderer.ts`: the one Canvas 2D implementation used in worker and fallback.
- `RenderTransport.ts`: worker handshake/error recovery. A failed transferred canvas
  is replaced before constructing the main-thread renderer. All six modes survive.
- `ColorControls.ts`: native preset/hue binding using the unchanged color math. Exact
  preset hex values, fractional hue, pastel saturation/lightness and neutral white
  remain intact. The native slider replaces obsolete canvas-knob pointer/wheel code.

## Signal policy

XY X is left, Y is right with positive Y upward, equal axis scale, a common sample
index set and no hidden rotation. Explicitly reported mono duplicates L to both axes.
Unknown-channel and stereo inputs retain real right-channel silence; a quiet stereo
channel must not be silently relabeled as mono. Track-ended events stop capture and
report disconnection. Browser/native capture and channel reports still require real
hardware verification.

## Work budgets and measurements

| Budget | Target output | Backing area cap | Dimension cap | Time FFT | Bands |
| --- | ---: | ---: | ---: | ---: | ---: |
| Eco | 24 fps | 460,800 px | 1,280 | 1,024 | 128 |
| Balanced (default) | 30 fps | 921,600 px | 1,920 | 1,024 | 128 |
| High | 60 fps | 2,073,600 px | 2,048 | 2,048 | 192 |

Area/dimension caps apply independently of devicePixelRatio. The frequency FFT is
2× the time FFT; changing quality rebuilds reusable typed capture buffers. Scope and
radial capture mono PCM only, XY captures paired PCM, and frequency modes capture
frequency data. Opening Diagnostics explicitly adds RMS sampling where needed.

The renderer ACK includes actual synchronous draw cost. Output is acknowledged
frames in the last second, not hardware display refresh. Skipped-busy counts show
backpressure; capture is skipped before copying/reading data if the worker is busy.
A worker that fails to ACK during two seconds of healthy visible producer ticks is
replaced by the same shared renderer. Main-thread/host gaps over 250ms do not count
as worker-failure evidence, avoiding false degradation after a whole-browser stall.

Waterfall history is 128 bands × 96 rows, accumulated at 20Hz independent of output
rate, with a palette-backed bitmap update and one scaled draw rather than thousands
of per-cell fillRect/color-string operations. Spectrum is bounded at 128 default /
192 high-quality bars, particles at 96, and XY at 1,024 paired points.

## Verification

`npm test` covers deterministic silence, sine RMS, impulse, mono, antiphase,
quadrature, ratio 1:2, silent stereo R, paired decimation bounds, pixel budgets,
frequency aggregation endpoints, source/request/cleanup races, pending AudioContext
resume, monitor zero, exact color contracts, fake-clock ACK backpressure and stale
messages, hidden/Stop, deadline/cadence stability, all six recording-canvas modes,
worker/main operation parity, and transferred-canvas fallback recovery.

Recording-canvas operation counts establish bounded work and interpretation, not GPU
cost, native audio alignment, browser focus behavior or real-world FPS. Parent browser
QA owns desktop/mobile layout, keyboard/focus/fullscreen, permission/UI races and
real screenshot comparison. No microphone permission or hardware audio has been
requested or exercised in the implementation environment.

Cloud check/build may need an external verification-only Astro config disabling the
Cloudflare inspector port because this sandbox denies network-interface enumeration.
The repository's deployment config is unchanged. Build/check logs are reported with
the handoff; a mocked test or focused frontend check is not a production deployment.

### Local verification result (2026-10-22)

- 57/57 tests passed, including unchanged home glyph/readability coverage and the
  migrated color contracts, actual reset-handler wiring, and supported/unsupported
  fullscreen entry/exit and failure handling.
- Astro check: 0 errors, 0 warnings, 0 hints.
- Production Cloudflare build passed using an external inspector-disabled config.
  The sandbox's Request.cf fetch timed out and used Cloudflare's placeholder;
  this is an environment warning, not a successful remote/deployed verification.
- Independent read-only review verified raw routing, shared renderer/fallback,
  generation guards, 24/30/60 deadlines, 20Hz waterfall, deferred-resume ownership
  and expired-output metrics. The browser-stall watchdog has a dedicated regression.

The source-executed recording-canvas comparison uses a fixed 1440×810 surface and
flat nonzero 4,096-bin input (aggregated to the new default 128 bands). Warm-frame
Spectrum fillRect calls fell from 635 to 129. Warm Waterfall changed from 114,049
fillRect/color writes to one background fill, one 128×96 bitmap update and one
scaled image draw. All six modes now do zero autonomous repaints without a new
frame and zero continued drawing after reset/Stop. These are operation counts,
not GPU timings or real-world FPS claims. XY deliberately retains up to 1,024
paired points, rather than the old 512, and the new reference grid adds line work.
At a 1920×1080 CSS viewport / DPR 2, the old default backing was 2,880×1,620
(4,665,600 pixels); Balanced is capped at 1,280×720 (921,600 pixels).
