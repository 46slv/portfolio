# Luminance-driven glyph instance background

## Scope

- Home only, on a fixed, decorative canvas below the existing content shell.
- The canvas has `pointer-events: none` and `aria-hidden="true"`. There is no DOM
  text splitting, layout replacement, added interaction layer, or new dependency.
- All rendered Home text opts in with `data-glyph-source`: branding, status,
  live clock/load labels, both names, English/Japanese biography and nested links,
  Recent Logs heading/dates/links, Work Scope labels/descriptions, Direct Link
  labels/arrows/descriptions, and both footer labels. Shared footer opt-in and the
  adaptive palette are conditional on Home. Responsive layouts reuse that same
  covered text tree; accessible-only canvas labels are not visible text sources.
- The existing `#cursor-light` styles, dimensions, stacking, blend mode and
  mousemove positioning remain unchanged. Its existing event handler also shares
  numeric coordinates with the background. No second UI glow is created.

## Rendering and interaction

Grid anchors remain stable between viewport resizes. Rendered positions follow
small continuous orbits with independent deterministic phases, at most 4.5px per
axis and below 0.4px/s. The two drift periods are about 97 and 119 seconds; they
are independent of the faster luminance waves. There is no wrap, respawn, random
per-frame step or position feedback. Tiny viewports reduce the radius to retain
points inside their cells. Dots and glyphs share the same moving position.

Each rendered position samples one analytic grayscale field made from smoothly flowing waves and a localized
contribution from the existing mouse position. Luminance controls both point size
and alpha, with true zero and one endpoints, not a global dimming overlay. Idle
points are dots. While an opted-in grapheme is hit, each visible point independently
renders a small instance of that same grapheme. This is not a large letter mask
filled with particles.

The waves use a 2.6× spatial scale relative to the original broad field, so smaller
light/dark lobes fit in narrow portrait viewports without changing point spacing.
Their phase advances 6× faster: individual wave periods are about 8, 12 and 15
seconds rather than 48, 70 and 90 seconds. The field visibly evolves within 1–2
seconds, continuously and without random per-frame noise. The mouse contribution
keeps its original 105px falloff and is combined before the same luminance mapping;
pointer activation is not required for idle animation on desktop or mobile.

Hit testing uses `elementFromPoint`, a text TreeWalker, `Intl.Segmenter`, and each
grapheme's `Range.getClientRects()`. Whitespace, gaps, and non-opted-in elements
return to dots. English, Japanese, combining marks, ZWJ emoji and flags retain
UTF-16 offsets. The fallback supports these common clusters conservatively; it
is not a complete implementation of every Unicode grapheme-break rule.

Luminance also supplies a **transition-delay map**. Each actual target change
snapshots that same field at every point: white starts immediately, black waits
420ms, and intermediate values interpolate between them. The captured delay does
not follow the moving field or reset on repeated hits of the same grapheme. After
the delay, a 360ms smoothstep crossfade changes that point to the newest target.
Opacity and scale continue sampling the live field throughout.

Target changes capture each point's current glyph pixels and dot weight, including
partially completed blends. Thus a rapid dot → A → B → Japanese → dot interruption
holds the current appearance during the new delay, without replaying an obsolete
pending glyph or resetting to a fully formed previous character. Two shared
off-DOM atlases flatten those snapshots, so historical glyph layers cannot grow.
Each visible point draws at most two glyph images plus its dot. Sprite alpha is
white, including for otherwise colored emoji.

## Local text readability

The Home route alone imports `home-readability.css` and enables the layout's
`homeBackground` flag. Seven local regions cover Header, Name, Bio, Recent Logs,
Work Scope, Direct Link and Footer. Owners remain outside entrance opacity and
the rotary mask. They preserve dimensions, spacing, font classes and link/hover
classes. The Bio wash still follows its existing `max-w-3xl` width.

Each region has the existing sharp-foreground/blurred-backdrop separation: only a
negative-z, noninteractive pseudo-element receives the 5px prefixed/unprefixed
backdrop blur and 12px feather. Its dark tint is now 65%, including the CSS-only
fallback. The canvas outside these local regions is unchanged.

During the existing draw pass, regions sample the maximum live luminance of the
nearby rendered points. Their bounds are cached and refreshed only after scroll,
resize or pageshow; no per-frame DOM layout measurement is added. Idle palette
updates are capped at about eight per second, with 0.2 luminance headroom. Pointer
and scroll changes request a fresh sample on the next existing render frame.
There are no extra animation loops or timers.

Home-scoped palette variables adapt existing white/zinc/green text tokens to the
measured field. Inherited status/arrow text receives the region's default tone.
Existing utility hover/focus colors, link transforms, pulse timing and Bio hover
dimming keep their ownership. Branding opacity and the status pulse minimum
increase in bright regions. The status pulse retains its two-second easing.
The palette uses `color-mix` behind `@supports`; unsupported browsers retain the
original text utilities over the local dark tint.

Numeric tests evaluate the declared palette, branding opacity, status pulse and
existing blue hover color over black-to-white source states and a conservative
sampling lag. They cover normal settled text states, not entrance opacity or the
intentional Bio hover dimming. Actual font pixels, blur compositing, CSS color-mix
rendering and hover readability remain real-browser acceptance items.

## Lifecycle and budget

- At most 2,600 points; backing-store device pixel ratio capped at 2.
- Two 32px-tile RGBA atlases consume at most 21,307,392 bytes (20.32 MiB) total,
  independent of viewport DPR. The 48px glyph-sprite cache has at most 32 entries
  (294,912 bytes). Eviction and cleanup explicitly release retired canvas stores.
  These are pixel-store budgets, not total browser/GPU memory. The existing
  visible canvas additionally uses roughly `4 × width × height × min(DPR, 2)²`
  bytes: 126.56 MiB at 3840×2160 and DPR 2 (about 147.16 MiB including both maximum
  atlases and the full sprite cache).
- Resizes reuse the same two atlas objects, clear their cells, and initialize new
  points to only the latest target. There are no per-point canvases or timers.
- Field drawing, spatial drift and target transitions share the same 30fps cap.
- Hidden documents and pagehide stop the animation. Visibility/pageshow resume
  without a large elapsed-time jump.
- Reduced motion freezes the field and changes glyphs without animation. It draws
  only when needed, without a standing requestAnimationFrame loop.
- The returned cleanup removes new listeners/subscriptions, clears sprite caches,
  and cancels the animation. Astro's before-swap event invokes it.

## Automated checks

`npm test` uses Node's built-in runner and TypeScript stripping (Node >=22.12,
already required by the project). Pure tests cover the point budget, stable
anchors, bounded independent drift, grayscale endpoints, meaningful 1–2 second pointer-free change, bounded
frame-to-frame change, finer spatial variation in desktop/portrait, pointer contribution,
bright-before-dark timing, snapshot deadlines, interrupted transitions, stale
target cancellation, return-to-dot, 10,000 rapid target alternations, atlas sizing,
200 repeated grid resizes, and both grapheme-segmentation paths.

A separate test transpiles the actual renderer with the existing TypeScript dev
dependency and uses small DOM/Canvas doubles. Across 120 distinct targets and
repeated mobile/desktop/4K resizes it checks two-buffer reuse, the 32-sprite limit,
DPR capping, unchanged deadlines on repeated hits, settling back to dots, hidden
document pause/resume, reduced-motion immediate updates without RAF, pagehide /
pageshow, and idempotent Astro cleanup. These doubles do not verify real raster
pixels, browser memory/GC, font rendering, or layout.

The renderer test also records the real canvas draw commands at desktop and
390×844 portrait sizes with no active pointer. It verifies substantial dot-alpha
changes after approximately one and two seconds of its RAF clock, without
requiring hover, text hit tests or glyph transitions. Assertions use broad
brightness-change bounds rather than exact frame timestamps.

Read-only diagnostics on `#glyph-field` expose `data-glyph`, `data-point-count`,
`data-render-mode`, `data-transition-policy`, `data-transition-revision`,
`data-transition-max-delay-ms`, `data-transition-fade-ms`,
`data-transition-delay-min-ms`, `data-transition-delay-max-ms`,
`data-transition-pending`, `data-transition-active`, and
`data-transition-atlas-bytes`. Delay ranges update only when the target changes;
pending/active counts update at most about eight times per second and stop
changing once settled. There is no global debug API.

### Initial feature verification on 2026-10-22

- Focused tests: 7 passed.
- Astro type check: passed, 23 files, zero errors/warnings/hints, using the
  frontend-only temporary config. Node tests use `.mjs`, so the frontend does not
  require a new Node type dependency.
- Default production command: blocked before compilation because this execution
  sandbox cannot enumerate host network interfaces (`uv_interface_addresses`).
- Cloudflare production build: passed, including workerd prerendering of all four
  routes, with a temporary external config using the supported
  `cloudflare({ inspectorPort: false })` option. The repository's production config
  is unchanged. Cloudflare's Request.cf discovery timed out and used its documented
  placeholder fallback during this build.
- Initial desktop browser blocker: direct Chromium launch was blocked by a sandbox
  socket restriction, and the supported cloud browser could not reach the
  sandbox-local preview server. This was subsequently **resolved** by serving the
  compiled Cloudflare build through a loopback-only server on the dot cloud
  desktop and using the supported cloud browser. The default build-command
  limitation above remains separate and unchanged.
- Desktop pointer interaction: **passed** at 1180×757. Moving the real desktop
  pointer onto English `S`, neighboring `h`, and Japanese `藤` selected the exact
  respective grapheme. Visible grid points repeated small instances of the selected
  character; the Japanese screenshot showed a readable glyph, not a missing-font
  box. Moving onto unmarked biography text returned to dots. The canvas reported
  1,802 points in animated mode. English and Japanese screenshots were captured,
  inspected, and shared for review.
- Baseline comparison with current main: **passed** at the same desktop viewport.
  All 17 link `href`/class pairs match. Header, h1, main and footer rectangles match
  exactly. The cursor light matches at 150×150px, with the same radial gradient,
  `screen` blend mode and z-index 9999. This verifies those measured properties,
  not every hover, rotary, navigation or lifecycle interaction.

### Transition-delay revision verification on 2026-10-22

- `npm test`: **12 passed**, including 11 pure field/timing/grapheme tests and
  one real-renderer test with DOM/Canvas doubles. Buffer ownership and lifecycle
  assertions are not real-browser memory or raster tests.
- Astro type check: **passed**, 24 files, zero errors/warnings/hints, using an
  external frontend-only config. No dependency or repository config changed.
- Cloudflare production build: **passed**, all four routes, using an external
  config with `cloudflare({ inspectorPort: false })`. Request.cf discovery again
  timed out and used the placeholder fallback. The default-command sandbox
  limitation recorded above remains; it was not fixed by changing production
  configuration.
- Actual cloud-desktop browser acceptance: **passed** for implementation commit
  `3d64a5ef065392ee1bfe9fff3d074838877e9f55` at 1180×757, using real mouse movement.
  The animated canvas reported 1,802 points and 14,794,752 atlas bytes. English
  `S` showed simultaneous pending/active points with advancing counts while its
  revision and captured 0–420ms delay range stayed unchanged. These diagnostics
  verify the configured renderer-clock map, not a wall-clock latency benchmark.
- Rapid `h` → `藤` → unmarked biography movement returned to dots and eventually
  zero pending/active points, without an obsolete target replay. Japanese `藤`
  settled into visible glyph instances. Moving within that same grapheme left
  revision 6 and the delay range unchanged despite the animated luminance field.
- Baseline parity was rechecked for this revision: all 17 link `href`/class pairs,
  header/h1/main/footer rectangles, and existing cursor-glow properties matched
  the earlier main baseline. No page-origin errors were observed in these flows;
  the captured errors were browser-extension metadata errors only.
- This is desktop evidence only. Native/mobile, reduced-motion pixels, lifecycle
  behavior and real browser memory/GC were not verified by these browser checks;
  lifecycle/resource ownership coverage above remains based on test doubles.

### Finer, faster field revision verification on 2026-10-22

- Only the analytic field coordinates/phase changed: spatial scale 2.6×, phase
  rate 6×. The three wave periods are now 8.06, 11.64 and 14.96 seconds. Grid
  spacing, pointer falloff, luminance endpoints, glyph transitions and renderer
  lifecycle are unchanged.
- Deterministic pointer-free samples at phases 0, 2, 5, 10, 20 and 30 seconds:
  - At 1440×900, mean absolute luminance change after one second rose from 0.031
    to 0.188, and after two seconds from 0.063 to 0.360. Average vertical total
    variation across three cross-sections rose from 0.933 to 2.084 (2.23×).
  - At 390×844, the same one/two-second changes rose from 0.023/0.045 to
    0.178/0.354. Vertical variation rose from 0.901 to 1.954 (2.17×).
  - At 320×740, one/two-second changes rose from 0.025/0.047 to 0.171/0.340.
    Vertical variation rose from 0.884 to 1.795 (2.03×).
  - The largest single-frame luminance change at 30fps stayed below 0.035 across
    these samples, with no random temporal noise. Initial frames contain true
    zero, intermediate and fully white samples on all three viewports.
- `npm test`: **22 passed**, including 14 glyph/renderer tests and the eight
  visualizer-color regression tests inherited from the base. The renderer's
  actual dot-alpha commands change without any pointer/text-hit event at desktop
  and portrait sizes. Hidden/pagehide pauses resume without fast-forward; reduced
  motion has no standing RAF and remains frozen on an idle redraw.
- Astro type check: **passed**, 26 files, zero errors/warnings/hints, using an
  external frontend-only config. Cloudflare production build: **passed**, all
  four routes, using an external `cloudflare({ inspectorPort: false })` config.
  The sandbox's default-command network-interface limitation is unchanged.
  Request.cf discovery used its existing placeholder fallback. Repository deploy
  configuration and dependencies are unchanged.
- These measurements are formula/test-double evidence, not real-browser or
  native-phone motion acceptance. The supplied phone screenshot documents static
  composition only; it does not establish that the animation stopped. Desktop
  and portrait browser acceptance of this revision remains separate.

### Biography opt-in and readability revision verification on 2026-10-22

- `npm test`: **26 passed**, including four new focused tests. Astro element-tree
  checks confirm explicit paragraph opt-in and six local backdrop owners outside
  both animated opacity and the rotary mask. CSS checks cover real prefixed and
  standard backdrop blur, negative-z placement and nonintercepting pointer events.
- A test invokes the real production hit-test function with DOM/Range doubles for
  English, Japanese, both nested CDs links, whitespace, inter-paragraph gaps and
  unmarked elements. These are coordinate/traversal checks, not browser font or
  actual mouse acceptance.
- Astro type check: **passed**, 27 files, zero errors/warnings/hints, using the
  external frontend-only config. Cloudflare production build: **passed**, all
  four routes, using the external `cloudflare({ inspectorPort: false })` config.
  Request.cf discovery used its existing placeholder fallback. Repository
  deployment configuration and dependencies are unchanged.
- Built HTML comparison with the parent revision confirms all 17 link
  href/class/target/rel tuples, visible text and script count are unchanged. The
  compiled home CSS retains both backdrop-filter forms; the three other routes
  do not receive the readability CSS. These static comparisons do not prove
  visual layout, actual filtering or interactive behavior.
- Analytic 2.6× spatial / 6× phase math, fixed grid, 0–420ms snapshot delays,
  renderer code, profile source, all link targets and deployment config are
  unchanged.
- Real desktop/portrait blur pixels, typography/layout parity, English/Japanese
  pointer hits, nested-link clicks and rotary scrolling require separate browser
  acceptance. No browser/server/DevTools was used for this implementation pass.

## Additional acceptance checks not yet completed

Historical desktop English/Japanese interaction and baseline comparisons above
apply to their named revisions. This spatial-drift/Home-text revision has no new
real-browser acceptance. The following additional checks remain; unit-test or implementation
coverage must not be mistaken for real-browser coverage:

1. Exercise link clicks, hover/scale effects, rotary scrolling and existing
   animations. Matching baseline classes alone do not establish these interactions.
2. Observe the idle field over time, with empty/intermediate/white points and
   subtle continuous position drift independent of the luminance waves.
3. Verify a Recent Logs link, including after scroll. Rapid heading-to-biography
   interruption and return-to-dot behavior are covered by the desktop checks above.
4. Verify the newly opted-in biography in English/Japanese, including both nested
   CDs links. Check all Home labels/links/footer and no-hit behavior on padding, whitespace,
   inter-paragraph gaps and viewport exit, plus ordinary text selection.
5. Test combining/emoji graphemes using a temporary opted-in test fixture, without
   changing production content. Test both normal and reduced-motion modes.
6. Test mobile/responsive rendering, reduced-motion idle pixels, hidden-tab
   pause/resume, cleanup, viewport resize, DPR >2 capping, and absence of the canvas
   on non-home routes. These lifecycle/mobile behaviors have not been browser-tested.
7. Inspect browser errors during those additional flows.

The transition-delay revision has its own desktop acceptance evidence above;
remaining checks must not be inferred from either that evidence or the unit tests.
Verification results do not by themselves authorize publication.


## Local revision verification - 2026-10-23

- All 61 committed production-function/renderer-fixture and existing regression
  tests pass. Contrast checks read the declared palette, inherited labels, the
  branding opacity rule and the status pulse rule separately.
- Frontend-only Astro check reports 38 files with zero errors, warnings or hints.
  A temporary static configuration without the Cloudflare adapter builds all four
  routes using the existing production frontend bundler and Tailwind plugin.
- Built Home HTML has 50 nonempty visible text runs, all within explicit glyph
  sources and the seven local readability regions. Clock, Gear and Visualizer
  output has neither the Home flag nor any glyph sources.
- Template comparison against the starting revision preserves text, structure,
  existing layout/hover classes, link attributes and interaction scripts. The
  intentional differences are Home opt-in attributes and the conditional footer
  readability owner.
- The ordinary adapter-aware check stops during Cloudflare initialization because
  the restricted environment cannot write the adapter log or open its local
  connection. That path was not retried; a full Cloudflare production build is
  not verified by the static frontend build above.
- No browser, GUI, server or publication was used for this revision. Source-derived
  motion plots/previews illustrate the implemented math, not browser compositing.
  Real Home desktop/mobile readability, hover/link/rotary behavior, reduced-motion
  appearance and device rendering cost remain acceptance checks.
