# SS_Portfolio Project Notes

Last updated: 2026-10-24 JST

This file is the working specification and implementation log for this repository. Keep it current when changing architecture, data ownership, UI behavior, or operational assumptions.

## Current Architecture

- Framework: Astro 6 with Tailwind v4 configured through `astro.config.mjs`.
- Shared page shell: `src/layouts/BaseLayout.astro`.
- Main page: `src/pages/index.astro`.
- Visualizer page: `src/pages/visualizer.astro`.
- Clock page: `src/pages/clock.astro`.
- Gear page: `src/pages/gear/index.astro`.
- Global CSS file: `src/styles/global.css`. Keep this minimal; Tailwind import remains the primary content.

## Home Global Brightness And Active Population - 2026-10-24

- The area-based count is now a capacity, capped at 2600. A fixed 16x12 grid
  samples the analytic gradient without pointer glow, star density or fades;
  its mean selects 55-100% of capacity. This avoids feedback from added stars.
- The mean has a 1.8s response, 0.2%-of-capacity count deadband (minimum one),
  and 6%-of-capacity/s count slew. Stable prefix IDs enter/leave over the existing
  0.5s presence fade. Zero-presence retiring IDs leave the actual draw loop.
  Active count means live IDs with presence above zero, including offscreen or
  locally dark stars; it is not a count of visible pixels.
- Global sampling runs at the existing capped cadence with no timer or extra
  RAF. Atlases are reserved once per resize, rather than rebuilt per count change.
  Hidden/reduced-motion clocks freeze the envelope and fades. Reduced geometry
  changes settle membership immediately; other resizes preserve normalized IDs.
- Local brightness-driven visibility, diagonal speed variation, glyph hover,
  text content/layout and the 64%/3px readability backplates are unchanged.
- Local validation: 78 tests pass, including real-ID growth/removal, Japanese
  hover during count changes and a simulated hour. Adapter-free Astro check has
  zero diagnostics across 39 files; its static build emits four routes. Home
  text source coverage remains 50/50 across seven regions.
- This revision is awaiting independent review. Browser/raster acceptance is
  NOT_RUN; automated population checks do not establish visual acceptance.

## Home Seeded Stars, Directional Flow And Text Response - 2026-10-23 (historical)

- Home reuses its existing Canvas 2D field, stable seeded point IDs and paused 30fps
  clock. The clarified motion is permanent down-right translation at (1.8, 1.2)
  CSS px/s nominally, with nine seeded speed factors from 0.84 to 1.16. A padded torus recycles only
  off-screen; an 18px screen-edge fade keeps entries/exits continuous.
- The grayscale field has a separate down-right translation at (2.4, 1.6) CSS
  px/s while retaining its existing color evolution. Bounded per-wave phases
  avoid moving an unbounded world coordinate; pointer light stays screen-anchored.
- Irregular seeded positions retain star-like sparse/dense patches. A fixed
  per-point density rank adds more stars in brighter gradient regions, fading
  smoothly instead of generating random values per frame. Existing brightness
  still controls size and alpha.
- Drawing, transition delays and local text response share the same final sample
  at each moving point, including density, population and screen-edge fades.
- Resize preserves normalized positions, ID/seed/rank/speed and wave phases.
  New/retiring prefix slots fade over 0.5s; the pool never exceeds 2600 points.
  Reduced motion freezes pending fades; a geometric resize while already reduced
  applies its target population without starting an animation.
- Every rendered Home text block supplies glyphs, including header clock/status,
  log dates, section labels, Direct Link details and the shared footer. Other
  routes do not enable the Home flag, field or palette.
- Seven local backplates retain stacking and feather geometry. Their local tint
  is 64% (previously 65%) and blur is 3px (previously 5px), transmitting more star
  detail behind text. Branding/status opacity compensates for readability.
- Actual visible luminance is checked every existing draw, with immediate upward
  text response when headroom is exceeded and capped downward release. Cached
  region bounds avoid repeated layout measurement; no new loop is added.
- Foreground strings, profile/log data, link targets, hover/rotary handlers and
  layout classes remain unchanged. The new palette is an intentional Home-only
  readability change. Bio hover dimming and entrance motion are retained.
- Reduced motion freezes dot positions and the field without a standing field
  RAF; hidden/pagehide pauses resume without a spatial jump.
- Local verification: 71 tests pass; frontend-only Astro check has no diagnostics
  and its static build emits all four routes. Built Home covers all 50 visible
  text runs. Cloudflare adapter initialization is blocked in the restricted
  environment, so full adapter build and real-browser acceptance remain open.
- See `docs/luminance-glyph-background.md` for exact evidence boundaries. Changes
  remain local until reviewed.

## Stable Content Boundaries

- Bio content is isolated in `src/components/Bio.astro`.
  - `index.astro` should render it via `<Bio name={name} />`.
  - Bio links are generated through `LINK_MAP` and `linkify()`.
  - `set:html` must receive only local constants defined in the component, not user input or external data.
- Logs are owned by `src/data/logs.ts`.
  - Add new log entries by prepending one object to `logs`.
  - `RotaryLogs.astro` imports `logs` from `../data/logs`.
  - `src/content/logs` is no longer the source of truth.
- Direct Link cards are owned by the `directLinks` array in `src/pages/index.astro`.
  - Add a card by appending one object to `directLinks`.
  - The rendered card structure and classes should remain stable.
- Gear entries still use the Astro content collection under `src/content/gear`.

## Visualizer Workspace Redevelopment - 2026-10-22

This supersedes the earlier v4 knob, full-screen engagement gate, global Tab shortcut,
DSP and silent-right duplication requirements in the historical entries below.

- `/visualizer` is an inspection/presentation workspace with an unobstructed canvas,
  a 300px desktop sidebar, and normal stacked document scrolling on mobile.
- Native labeled controls group Input, View, Appearance and optional Diagnostics.
  OSC, Spectrum and XY are primary; Radial, Waterfall and Particles are secondary.
- Source states are explicit: idle, requesting, mic, demo, error, disposed. Demo is
  generated PCM with ideal frequency magnitudes, silent and independent of Web Audio.
  Microphone permission is requested only from the user's microphone action.
- `AudioEngine` owns a raw analysis graph, generation-guarded stream acquisition,
  device-ended listeners, and exactly-zero default monitor/analysis sink gains.
  Display gain does not change monitor volume. Stop, source changes, hidden pages
  and cleanup release microphone tracks, including late permission completions.
  Hidden microphone capture requires an explained, explicit restart; demo resumes.
- Known mono inputs explicitly duplicate L into R. Unknown/stereo inputs preserve a
  genuinely silent right channel. XY uses common paired sample indices, equal axis
  scale, positive Y upward and no hidden rotation.
- `src/lib/visualizer/Renderer.ts` is the shared Canvas 2D renderer for worker and
  main-thread fallback, with all six modes in both paths. Worker failure replaces
  the transferred canvas and reports the degraded path visibly.
- `FramePump` owns one main RAF deadline and at most one unacknowledged frame.
  Worker rendering occurs only on a frame message and ACKs ID, generation and
  actual draw cost. No capture/render work is scheduled when stopped or hidden.
- Coherent Eco/Balanced/High budgets set FPS, FFT, frequency bands and backing area.
  Balanced defaults to 30fps / 0.92MP, and every preset is capped at FHD area plus
  an independent dimension cap regardless of DPR. Waterfall is a 128×96 ring/bitmap,
  with accumulated 20Hz history; motion and persistence use elapsed visible time.
- Cosmetic glow, persistence and CRT scanlines default off. Color preserves the
  existing exact preset, hue, pastel lightness, neutral-white and reset contracts.
- Focus view has an explicit exit and Escape; Tab remains normal keyboard navigation.
- See `docs/visualizer-workspace.md` for architecture, verification and limitations.

## Header Notes

- `src/components/Header.astro` owns the header clock interval.
- `src/pages/index.astro` must not define another `#sys-time` interval.
- Header center visualizer is intentionally subtle and links to `/visualizer`.
- Header time links to `/clock` but should not look like a prominent navigation element.

## Timer Notes

- Timer logic lives in `src/scripts/timer-engine.ts`.
- `TimerEngine` is DOM-independent except for browser timer APIs.
- `/clock` uses `TimerEngine` for wall clock, count-up, laps, and countdown.

## Content Collections

- Astro 6 uses `src/content.config.ts`, not legacy `src/content/config.ts`.
- Current collection:
  - `gear`: loaded from `src/content/gear/*.md`
- Removed collection:
  - `logs`: replaced by `src/data/logs.ts`

## Verification Baseline

Before handing off structural changes, run:

```bash
npx astro check
npm run build
```

Expected current caveat:

- None. `npx astro check` should report 0 errors, 0 warnings, and 0 hints.

## Change Discipline

- Keep unrelated dirty files untouched.
- Do not rewrite protected text/content unless explicitly requested.
- When extracting content into components or data files, preserve strings and class names unless the task explicitly authorizes content edits.
- Prefer small data arrays for low-volume, manually curated site content.
- Prefer Astro content collections for larger structured markdown groups where rendering markdown body is needed.

## Open Bug Audit - 2026-06-08 JST

Scope: discovery only. No behavioral fixes were applied in this pass.

Verification run:

- `npx astro check`: 0 errors, 1 existing hint for unused `snsLinks` in `src/pages/index.astro`.
- `npm run build`: successful static build for `/`, `/clock`, `/gear`, and `/visualizer`.
- Browser smoke test at `http://127.0.0.1:4321/`: desktop 1280x720 and mobile 390x844 for `/`, `/clock`, `/visualizer`, and `/gear`.
- Console smoke test: no warnings or errors observed on those page loads.
- Source encoding note: PowerShell may display Japanese text as mojibake, but Node UTF-8 inspection showed the source strings are valid Japanese. Do not treat this as source corruption without byte-level confirmation.

High priority:

- `/clock` wall clock freezes while the timer is idle. Browser evidence: `#wall-clock` stayed at the same value after a 1.6s wait. Cause: `TimerEngine` only schedules ticks while count-up or countdown is active. Fix by separating wall-clock ticking from stopwatch/countdown ticking, or by adding an always-on clock tick mode.
- Visualizer hue control can break worker-rendered color fills. The hue knob calls `setAccent("hsl(...)")`, but `visualizer-worker.ts` `cssAlpha()` parses the accent as a hex string. Spectrum, waterfall, particle, and pixel-map fills can become invalid colors after hue changes. Fix by storing accent as normalized RGB/hex data or by making the worker parse CSS colors safely.
- `visualizer-worker.ts` uses `setTimeout(loop, 0)` as a permanent render poll. This can waste CPU and battery even when drawing at a lower target FPS. Fix by scheduling the next loop based on the target interval and page visibility.
- Visualizer mic start has no failure state. If `getUserMedia()` is denied or unavailable, `startAudio()` rejects without user feedback because the click handler intentionally discards the promise. Fix with try/catch, visible status text, and button-state recovery.

Medium priority:

- The visualizer `Speed` knob is currently a dead control. It is rendered in PRIMARY, but its handler only reassigns `params.targetFps` to the current `targetFps` and does not use the knob value. Define its intended meaning or remove it.
- Device switching can leak stale audio graph nodes. `AudioEngine.initInput()` stops old stream tracks but does not disconnect the previous `sourceNode` before replacing it. Reuse `stopInput()` or explicitly disconnect before creating the new source.
- Worker fallback is fragile after `transferControlToOffscreen()`. `workerReady` is set immediately after posting `init`; asynchronous worker module failure has no ack/error recovery, and the canvas has already been transferred. Add a worker handshake and error path before considering the worker active.
- `RotaryLogs` assumes `logs.length > 0`. If logs are temporarily cleared, `totalHeight` becomes `0` and modulo math produces invalid transforms. Add an empty-state guard.
- External links opened with `target="_blank"` in direct links and rotary logs do not include `rel="noopener noreferrer"`. Add it consistently.
- Clipboard copy paths are brittle. Gear copy awaits `navigator.clipboard.writeText()` without failure UI; the home page still contains dead `copy-email-btn` script even though no button exists. Remove the dead script or restore the control, and add clipboard failure handling.
- Gear title extraction uses the whole markdown body after stripping one heading marker. If gear entries gain descriptions, card titles and copied markdown will include unintended body text. Extract only the first heading or add a frontmatter title.

Content/data cleanup candidates:

- `src/data/logs.ts` has two entries with the same URL: `https://x.com/Wata_kanro/status/1927654765754003841?s=20`. Confirm whether this is intentional before deduping.
- `/visualizer` mobile layout is usable but the open control panel consumes most of the first viewport. Consider defaulting the panel closed or using a compact mobile mode if the waveform should be the first visual signal.
- Home SNS cleanup is complete for now: the unused `snsLinks` array was removed from `src/pages/index.astro`.

## Stabilization Pass - 2026-06-08 JST

Goal: make the site feel normal and dependable before deeper redesign work.

Implemented:

- `/clock`: `TimerEngine` now keeps ticking while a UI subscriber exists, so the wall clock updates even when stopwatch/countdown are idle.
- `/`: removed dead SNS data and the orphaned `copy-email-btn` script; direct external links now use `rel="noopener noreferrer"`.
- `RotaryLogs`: external log links now use `rel="noopener noreferrer"` and the rotary script guards against an empty log list.
- `/gear`: markdown title extraction now uses the first `# ` heading only, so future body text will not leak into card titles or copied frontmatter snippets.
- `/gear`: copy buttons now fall back to a legacy textarea copy path and show `COPY FAILED` only if both Clipboard API and fallback copy reject.
- `AudioEngine`: `initInput()` now calls `stopInput()` before opening a new stream, disconnecting stale source nodes during device switches.
- `/visualizer`: `Speed` is now a real motion-speed parameter for demo rendering instead of a dead control.
- `/visualizer`: worker color messages are normalized to hex so the hue knob cannot feed unsupported `hsl(...)` strings into worker `rgba()` generation.
- `visualizer-worker`: render polling is now interval-aware instead of `setTimeout(loop, 0)`.
- `/visualizer`: mic start is wrapped in a failure path that restores buttons and reports `MIC BLOCKED` / `mic unavailable`.
- `/visualizer`: worker rendering now waits for a `ready` message before frame messages are considered active.

Current roadmap:

- Phase 1, confidence pass: keep checks green and manually smoke test `/`, `/clock`, `/visualizer`, and `/gear` after every stabilization batch.
- Phase 2, content truth: inspect `src/data/logs.ts` with the user-visible source list and decide whether the duplicate X URL is an intentional alternate title or a data error before deleting it.
- Phase 3, mobile visualizer UX: decide whether `/visualizer` should open with the panel closed on mobile, use a compact panel, or prioritize waveform-only first paint.
- Phase 4, interaction polish: add explicit disabled/loading states for mic startup, copy buttons, and panel toggles so clicks always acknowledge user intent.
- Phase 5, regression tests: add focused unit tests for `TimerEngine`, `getGearTitle()`, worker color normalization, and empty-log rendering if a test runner is introduced.

## Visualizer And CMS Roadmap - 2026-06-08 JST

Near-term implementation decisions:

- Lissajous mode must be treated as an XY oscilloscope mode, not a decorative phase effect.
  - X axis: left-channel time-domain samples.
  - Y axis: right-channel time-domain samples.
  - If the input is mono or the right channel is effectively silent, duplicate left into right rather than inventing an artificial phase offset.
- Fullscreen visualizer defaults should favor practical performance:
  - 30 FPS target
  - render scale `0.75`
  - sample density `1:2`
  - higher-cost modes remain opt-in through the panel.
- Worker frame payloads should only include the data a mode needs. Scope and lissajous do not need frequency arrays every frame.
- `/visualizer` should present an engagement gate before microphone startup. The first click is the explicit user gesture that attempts `getUserMedia()`.
- Browser microphone permission cannot be bypassed. If permission is blocked, the gate should remain available as a retry surface.
- `/visualizer` controls should separate global controls from mode-specific visual shaping. The global group owns monitor, motion, size, beam, glow, and decay; the mode detail group owns the geometry labels that change with the active rendering mode.

CMS-like editing proposal:

- Do not start with a full authenticated CMS. This site is static, personal, and visually specific; a heavy CMS would add maintenance before the content model is stable.
- Start with a local "composition data" layer under `src/data` or `src/content/layouts`.
- Represent pages as ordered blocks with explicit layout fields:
  - `type`: `text`, `image`, `gallery`, `link`, `embed`, `spacer`, `note`, `work`
  - `position`: grid row/column, span, alignment, z-index
  - `media`: local public path or content collection asset reference
  - `typography`: size token, weight, tracking, tone
  - `visibility`: draft/published, page target, optional date range
- Render those blocks through a small set of Astro components rather than allowing arbitrary HTML first.
- Add an editor only after the block schema is stable:
  - Phase A: hand-edit typed data files with preview.
  - Phase B: add JSON schema validation and example templates.
  - Phase C: build a local-only visual editor page that writes/copies JSON.
  - Phase D: consider Decap CMS, TinaCMS, or a custom admin only if publishing friction becomes the actual bottleneck.

Implemented in this pass:

- `AudioEngine` now exposes stereo time-domain data for lissajous rendering via separate left/right analysers.
- `visualizer-worker` now draws lissajous from simultaneous X/Y channel samples instead of offsetting one mono waveform.
- Main-thread fallback lissajous rendering now uses the same X/Y interpretation.
- Default visualizer load was reduced to 30 FPS, render scale `0.75`, and sample density `1:2`.
- Worker frame messages now skip frequency data outside frequency-driven modes.
- `/visualizer` now starts behind a full-screen `ENGAGE` overlay. Clicking it attempts microphone startup from a valid user gesture, hides only after successful startup, and returns on `STOP`.
- `/visualizer` control UI now separates `GLOBAL`, `MODE`, and `MODE DETAIL`; mode detail labels change for oscilloscope, spectrum, lissajous, radial, waterfall, and particle modes.
