# Shared Home light field

This is a local candidate based on published PR #10. Publication and actual
browser appearance are separate acceptance gates. No new glow is public yet.

## One light behind content

Home no longer renders the independent topmost `#cursor-light` disk. Its existing
Canvas remains behind the content, with pointer events disabled. The layout's
raw mouse coordinates still drive immediate grapheme hit testing. Other pages
retain their cursor element, screen blend and positioning behavior.

The existing animated monochrome gradient supplies normalized linear light `B`.
At distance `r` from the eased light coordinates:

```
s = clamp(min(viewportWidth, viewportHeight) / 700, 0.7, 1)
G(r) = strength * (0.70 * exp(-r^2 / (2*(95*s)^2))
                + 0.12 * exp(-r^2 / (2*(280*s)^2)))
L = B + G*(1 - B)
```

The center influence remains 0.82. The Gaussian shoulder has no finite radial
stop, box filter or radial crop. Linear screen is a design choice: it preserves
headroom instead of making a flat clipped spotlight. A gradient already at 1
stays at 1; a darker gradient remains below 1 even at the halo center. The same
`L` drives brightness, local occupancy, rare-dot eligibility and the wash.
Global active-point population continues to sample the gradient with pointer
inactive. Moving the pointer therefore changes local visibility without adding
active IDs. PR10's deterministic ranks, 1.3-7x linear tail, speed lanes and cap
are retained. Unlike PR10, eligibility now includes the halo, as requested by
the shared-field contract; it is not a separately painted large-dot spotlight.

## Restrained wash and input

One reusable canvas samples the full viewport at roughly one sample per 32 CSS
pixels, capped at 4096 pixels and 128 per axis. Canvas upsampling covers the full
viewport. There is no full-resolution analytic loop or per-dot blur.

The wash decodes Home's #0a0a0a to linear sRGB, adds at most `0.0045*L`, then
re-encodes through a cached 1025-entry byte LUT. Encoded grayscale is 10-21, keeping
the field near black. The wash is painted behind dots; it never overlays text.
Its maximum contribution relative to the existing white-dot range is 11/245,
below the existing 0.2 text headroom. Text colors, local 64% tint and 3px blur are
unchanged. The wash requires at most 16KiB of RGBA storage plus 1025 LUT bytes;
the two glyph atlases, point limit 2600 and DPR cap 2 remain unchanged.

Position and strength use `1-exp(-dt/tau)` on the existing paused animation clock,
with tau 90ms and 140ms. Pointer amplitude fades within 48 CSS pixels of viewport
edges and on exit. Below 1e-6 strength the temporal tail is zeroed to stop halo
evaluation; the spatial Gaussian has no radial cutoff. The motion-enabled
renderer retains its 30fps cap; hidden and
page pauses do not fast-forward. Reduced motion keeps the field frozen and
uses immediate static input snapshots, including static exit, without a standing
RAF. Every static lifecycle redraw snapshots the current raw pointer before
sampling or retargeting. This also clears obsolete light after a hidden-tab return
or when reduced motion interrupts an exit fade; field phases and population stay
frozen. It does not animate the follow/fade while reduced. Hit testing always uses
the actual input coordinates, so the light's follow never delays link/glyph hits.

## Evidence and remaining acceptance

Twelve new tests check Gaussian tail/derivatives, linear composition, frame-time
follow and edges, exact wash/point inputs, buffer reuse and release, Home-only
disk removal, exit/hide/reduced behavior, and identical actual ID histories with
and without pointer light. Four lifecycle regressions also cover hidden/visible
and page restore, exit-fade interruption, preference changes in either direction
while hidden, and active-pointer snapshots followed by resumed eased motion.
These four fail before the review correction and pass after it. The independent
reviewer's unchanged two-case reproduction also passes after the correction.
Existing field, Japanese hover, text contrast,
directional flow and population tests remain passing (97 aggregate tests).
Final adapter-free Astro check reports no diagnostics across 41 files; its static
build emits four routes and preserves 50 Home text runs in seven regions. Home's
cursor disk is absent in generated HTML; the other three routes retain theirs.

Code-derived previews cover desktop/portrait, center/edge and dim/bright gradient
states. They approximate circle antialiasing and the previous CSS disk, use a
frozen-mean population target, and contain no foreground/font/backplate rendering.
They are not browser screenshots or device cadence evidence. Actual radial
appearance, 8-bit banding, font/blur compositing, physical hover, sustained frame
cost and GC remain NOT_RUN because no browser is available in this lane.

## Primary references

The composition/calibration above is an implementation choice, informed by:

- [W3C CSS Color4](https://www.w3.org/TR/css-color-4/#color-conversion-code):
  linear-light sRGB and its transfer functions inform the cached wash conversion.
- [W3C Compositing1](https://www.w3.org/TR/compositing-1/#blendingscreen): the
  screen equation is applied to the monochrome linear-light model here.
- [W3C Filter Effects1](https://www.w3.org/TR/filter-effects-1/): filter regions
  can clip an effect. This implementation instead samples an analytic full-field
  halo with no small radial filter box.

References checked 2026-10-24. They do not establish perceived visual quality.
