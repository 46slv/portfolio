# Large particle glyphs and cached glow

Only Home's background particle representation changes. Actual page text,
content, hit testing, hover targets and the other routes remain untouched.

The existing seeded largeRank/sizeRank and shared field produce one live linear
multiplier m in 1-7, already faded by screen edges and population presence. Dots,
new glyph targets and interrupted glyph snapshots all use this same sample:

```
dot radius = (0.24 + 1.01*brightness) * m
glyph destination size = (5 + 9*brightness) * m
halo radius = (6 + 3*(0.24 + 1.01*brightness)) * m
halo opacity = 0.12 * smoothstep(1, 3, m) * visibleLuminance
```

The normal 1x glyph remains 5-14 CSS pixels, while the theoretical 7x maximum is 98px.
The dot radius limit 8.75px and halo radius limit 68.25px remain finite. The size
rank is stable, not rerolled at representation changes. Field evolution can
still change m smoothly as before. Existing dot/source/target transition weights,
deadlines, positions and membership are retained; halo alpha ignores glyph
crossfade progress so it does not wink out during a representation change.
Normal 1x particles have zero glow. The enlarging tail gains glow continuously.

The single 96x96 white-alpha sprite samples a Gaussian core and shoulder at mount:

```
r = normalized distance from sprite center
t = clamp((r - 0.55)/0.45, 0, 1)
tail = 1 - t^3 * (10 - 15*t + 6*t^2)
alpha = (0.78*exp(-r^2/(2*0.20^2))
       + 0.22*exp(-r^2/(2*0.42^2))) * tail
```

The monotone broad tail reaches zero with zero first/second derivatives at r=1;
the cached image border is transparent. There is no hard radial stop or ring in
the analytic function. This is not a claim about browser banding or raster
quality. Only the finite particle sprite uses this tail; PR11's analytic cursor
halo remains unbounded, with its separate core/shoulder geometry unchanged.

The halo is drawn in the existing background canvas, before that particle's
core, behind content and the existing readability backplates. No blur filter,
shadow filter, per-particle canvas or new animation loop is used. One 96x96 RGBA
canvas adds 36KiB plus one initial 36KiB upload buffer. It survives resizes and is
released at cleanup. Atlases remain 32px tiles, at most 20.32MiB, with at most 32
48px glyph sprites; wash budget 4096 pixels, point cap 2600, DPR 2 and animated 30fps
cap are unchanged. Sustained GPU/frame-time cost is not established offline.

Text observation expands cached bounds to 78px: maximum halo 68.25px plus three
existing 3px blur sigmas, also covering the 98px glyph destination. For relevant
points the existing core maximum is combined with the conservative halo union
H=1-product(1-haloOpacity). The resulting observation is core+(1-core)*H, with
the existing 0.2 wash/release headroom. This observation only updates text contrast;
emitted halos cannot inflate field light, multiplier, density or global count.
The 64% tint/3px blur and foreground palette equations stay unchanged.

Seven new offline tests check shared size ratios, normal particles, C2 tail and
sprite pixels, size/presence/edge fades, actual dot-glyph-dot destination geometry,
exact dot/source/target alpha weights under interruption, cache/allocation reuse,
hidden/reduced-motion return and conservative text observation. A separate
before/after source differential compares all prior sample fields and global
means with the published PR11 implementation.

Actual browser/font rasterization (including enlarged cached glyphs), perceived
glow/rings/banding, physical hover and sustained device/GC load remain NOT_RUN.
No SVG, equation, Canvas double or static build is browser visual acceptance.
Independent source review is required before publication of this increment.
