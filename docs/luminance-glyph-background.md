# Luminance-driven glyph instance background

## Scope

- Home only, on a fixed, decorative canvas below the existing content shell.
- The canvas has `pointer-events: none` and `aria-hidden="true"`. There is no DOM
  text splitting, layout replacement, added interaction layer, or new dependency.
- The name heading (English and Japanese) and Recent Logs text links explicitly
  opt in with `data-glyph-source`. Other text does not activate the field.
- The existing `#cursor-light` styles, dimensions, stacking, blend mode and
  mousemove positioning remain unchanged. Its existing event handler also shares
  numeric coordinates with the background. No second UI glow is created.

## Rendering and interaction

The point positions are fixed between viewport resizes. Each point samples one
analytic grayscale field made from broad, slowly moving waves and a localized
contribution from the existing mouse position. Luminance controls both point size
and alpha, with true zero and one endpoints, not a global dimming overlay. Idle
points are dots. While an opted-in grapheme is hit, each visible point independently
renders a small instance of that same grapheme. This is not a large letter mask
filled with particles.

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
- Field drawing capped at 30 frames per second.
- Hidden documents and pagehide stop the animation. Visibility/pageshow resume
  without a large elapsed-time jump.
- Reduced motion freezes the field and changes glyphs without animation. It draws
  only when needed, without a standing requestAnimationFrame loop.
- The returned cleanup removes new listeners/subscriptions, clears sprite caches,
  and cancels the animation. Astro's before-swap event invokes it.

## Automated checks

`npm test` uses Node's built-in runner and TypeScript stripping (Node >=22.12,
already required by the project). Pure tests cover the point budget, fixed
positions, grayscale endpoints, slow temporal change, pointer contribution,
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

## Additional acceptance checks not yet completed

Core desktop English/Japanese interaction and the baseline comparison above are
verified. The following additional checks remain; unit-test or implementation
coverage must not be mistaken for real-browser coverage:

1. Exercise link clicks, hover/scale effects, rotary scrolling and existing
   animations. Matching baseline classes alone do not establish these interactions.
2. Observe the idle grid over time, with fully empty areas, intermediate
   brightness and genuinely white points. Point positions must not move.
3. Verify a Recent Logs link, including after scroll. Rapid heading-to-biography
   interruption and return-to-dot behavior are covered by the desktop checks above.
4. Extend no-hit testing beyond the verified biography to unmarked links, padding,
   whitespace and viewport exit. Check ordinary text selection.
5. Test combining/emoji graphemes using a temporary opted-in test fixture, without
   changing production content. Test both normal and reduced-motion modes.
6. Test mobile/responsive rendering, reduced-motion idle pixels, hidden-tab
   pause/resume, cleanup, viewport resize, DPR >2 capping, and absence of the canvas
   on non-home routes. These lifecycle/mobile behaviors have not been browser-tested.
7. Inspect browser errors during those additional flows.

The transition-delay revision has its own desktop acceptance evidence above;
remaining checks must not be inferred from either that evidence or the unit tests.
Verification results do not by themselves authorize publication.
