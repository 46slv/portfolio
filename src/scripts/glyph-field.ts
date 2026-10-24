import {
  advanceFieldMotion, advancePointPresence, createFieldMotion, createGlyphTransition, FIELD_PADDING, GRADIENT_VELOCITY,
  GLYPH_ATLAS_TILE_SIZE, GLYPH_FADE_SECONDS, GLYPH_MAX_DELAY_SECONDS,
  glyphAtlasLayout, makePoints, pointCount, MAX_DPR, POINT_VELOCITY, samplePoint, type FieldPoint,
  retargetGlyphTransition, segmentGraphemes, transitionDotWeight, transitionProgress,
} from '../lib/glyph-field';
import { clearCursorPointer, cursorPointer, subscribeCursorPointer } from '../lib/cursor-pointer';

/** Resolve only explicitly opted-in, actually hit text. Never split/rewrite the DOM. */
function glyphAtPoint(x: number, y: number): string {
  const hit = document.elementFromPoint(x, y);
  const source = hit?.closest<HTMLElement>('[data-glyph-source]');
  if (!source) return '';

  const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? '';
    for (const { segment, index } of segmentGraphemes(text)) {
      if (/^\s+$/u.test(segment)) continue;
      range.setStart(node, index);
      range.setEnd(node, index + segment.length);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) {
          return segment;
        }
      }
    }
  }
  return '';
}

export function mountGlyphField(canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return () => {};
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sprites = new Map<string, HTMLCanvasElement>();
  // Two shared, off-DOM atlases flatten interrupted blends. There are no per-point
  // canvases, historical glyph layers, queued timers, or growing transition lists.
  const tileSize = GLYPH_ATLAS_TILE_SIZE;
  const makeAtlas = () => {
    const image = document.createElement('canvas');
    return { image, pen: image.getContext('2d')! };
  };
  let sourceAtlas = makeAtlas();
  let captureAtlas = makeAtlas();
  let points: Array<FieldPoint & {
    cellX: number; cellY: number; fromHasGlyph: boolean; targetPresent: boolean;
    transition: ReturnType<typeof createGlyphTransition>;
  }> = [];
  let targetPointCount = 0;
  const readability = Array.from(document.querySelectorAll<HTMLElement>('[data-home-background] .home-readability'))
    .map((element) => ({
      element, previous: element.style.getPropertyValue('--home-background-luminance'),
      bounds: { left: 0, right: 0, top: 0, bottom: 0 }, light: 0, appliedLight: -1,
    }));
  let readabilityBoundsDirty = true;
  let readabilityNeeded = true;
  let lastReadability = -1;
  let width = 0;
  let height = 0;
  let target = '';
  let frame = 0;
  let previousTime = 0;
  let lastDraw = 0;
  let seconds = 0;
  const fieldMotion = createFieldMotion();
  let hitTestNeeded = false;
  let disposed = false;
  let pageHidden = false;
  let revision = 0;
  let lastDiagnostics = -1;
  canvas.dataset.transitionPolicy = 'luminance-snapshot';
  canvas.dataset.transitionMaxDelayMs = String(GLYPH_MAX_DELAY_SECONDS * 1000);
  canvas.dataset.transitionFadeMs = String(GLYPH_FADE_SECONDS * 1000);
  canvas.dataset.glyph = target;
  canvas.dataset.transitionRevision = String(revision);
  canvas.dataset.pointMotion = 'seeded-diagonal-flow';
  canvas.dataset.densityPolicy = 'stable-rank-luminance';
  canvas.dataset.pointVelocity = `${POINT_VELOCITY.x},${POINT_VELOCITY.y}`;
  canvas.dataset.gradientVelocity = `${GRADIENT_VELOCITY.x},${GRADIENT_VELOCITY.y}`;
  canvas.dataset.fieldPaddingPx = String(FIELD_PADDING);

  const spriteFor = (glyph: string): HTMLCanvasElement => {
    const cached = sprites.get(glyph);
    if (cached) return cached;
    if (sprites.size >= 32) {
      const oldest = sprites.keys().next().value!;
      const retired = sprites.get(oldest)!;
      retired.width = retired.height = 0;
      sprites.delete(oldest);
    }
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 48;
    const pen = sprite.getContext('2d')!;
    pen.fillStyle = '#fff';
    pen.textAlign = 'center';
    pen.textBaseline = 'middle';
    const family = 'ui-monospace, SFMono-Regular, "Noto Sans CJK JP", monospace';
    pen.font = `32px ${family}`;
    const measured = pen.measureText(glyph).width;
    if (measured > 38) pen.font = `${32 * 38 / measured}px ${family}`;
    pen.fillText(glyph, 24, 25);
    // Color emoji become the same white alpha silhouette as every other glyph.
    pen.globalCompositeOperation = 'source-in';
    pen.fillRect(0, 0, 48, 48);
    sprites.set(glyph, sprite);
    return sprite;
  };

  const retarget = (next: string) => {
    captureAtlas.pen.clearRect(0, 0, captureAtlas.image.width, captureAtlas.image.height);
    captureAtlas.pen.globalCompositeOperation = 'lighter';
    let minDelay = GLYPH_MAX_DELAY_SECONDS;
    let maxDelay = 0;
    const previousSprite = target ? spriteFor(target) : null;
    for (const point of points) {
      const progress = transitionProgress(point.transition, seconds);
      // Capture what this point is displaying now, including any interrupted
      // mixture. The new delay holds that image, never an obsolete queued glyph.
      const fromHasGlyph = point.fromHasGlyph && progress < 1;
      if (fromHasGlyph) {
        captureAtlas.pen.globalAlpha = 1 - progress;
        captureAtlas.pen.drawImage(sourceAtlas.image,
          point.cellX, point.cellY, tileSize, tileSize,
          point.cellX, point.cellY, tileSize, tileSize);
      }
      const targetHasGlyph = previousSprite !== null && progress > 0;
      if (targetHasGlyph) {
        captureAtlas.pen.globalAlpha = progress;
        captureAtlas.pen.drawImage(previousSprite!, point.cellX, point.cellY, tileSize, tileSize);
      }
      point.fromHasGlyph = fromHasGlyph || targetHasGlyph;
      const { luminance } = samplePoint(point, fieldMotion, width, height, cursorPointer);
      retargetGlyphTransition(point.transition, next, luminance, seconds);
      const delay = point.transition.startsAt - seconds;
      minDelay = Math.min(minDelay, delay);
      maxDelay = Math.max(maxDelay, delay);
    }
    [sourceAtlas, captureAtlas] = [captureAtlas, sourceAtlas];
    target = next;
    canvas.dataset.glyph = target;
    canvas.dataset.transitionRevision = String(++revision);
    canvas.dataset.transitionDelayMinMs = String(Math.round(minDelay * 1000));
    canvas.dataset.transitionDelayMaxMs = String(Math.round(maxDelay * 1000));
    lastDiagnostics = -1;
  };

  const updateTarget = () => {
    const next = cursorPointer.active ? glyphAtPoint(cursorPointer.x, cursorPointer.y) : '';
    if (next !== target) retarget(next);
    hitTestNeeded = false;
  };

  const draw = () => {
    context.clearRect(0, 0, width, height);
    const refreshReadability = readabilityNeeded || lastReadability < 0
      || seconds - lastReadability >= 0.12 || motion.matches;
    for (const region of readability) {
      if (readabilityBoundsDirty) {
        const rect = region.element.getBoundingClientRect();
        // Include nearby glyph pixels and the existing local backdrop blur.
        region.bounds = {
          left: Math.max(0, rect.left - 16), right: Math.min(width, rect.right + 16),
          top: Math.max(0, rect.top - 16), bottom: Math.min(height, rect.bottom + 16),
        };
      }
      region.light = 0;
    }
    readabilityBoundsDirty = false;
    const sprite = target ? spriteFor(target) : null;
    let pending = 0;
    let active = 0;
    context.fillStyle = '#fff';
    for (const point of points) {
      const { x, y, luminance, brightness } = samplePoint(point, fieldMotion, width, height, cursorPointer);
      const progress = transitionProgress(point.transition, seconds);
      if (progress < 1) {
        if (seconds < point.transition.startsAt) pending++;
        else active++;
      }
      const dotWeight = transitionDotWeight(point.transition, progress);
      // Brightness and size stay live. Only the transition deadline is frozen.
      for (const region of readability) {
        const bounds = region.bounds;
        if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
          region.light = Math.max(region.light, luminance);
        }
      }
      if (luminance <= 0.002) continue;
      if (dotWeight > 0) {
        context.globalAlpha = luminance * dotWeight;
        context.beginPath();
        context.arc(x, y, 0.24 + brightness * 1.01, 0, Math.PI * 2);
        context.fill();
      }
      const size = 5 + brightness * 9;
      const drawSource = point.fromHasGlyph && progress < 1;
      const drawTarget = sprite !== null && progress > 0;
      // Overlapping white-alpha layers add, so a crossfade cannot dim shared
      // strokes accidentally. Idle dots and settled glyphs need no mode changes.
      const additive = (drawSource && drawTarget) || (dotWeight > 0 && (drawSource || drawTarget));
      if (additive) context.globalCompositeOperation = 'lighter';
      if (drawSource) {
        context.globalAlpha = luminance * (1 - progress);
        context.drawImage(sourceAtlas.image, point.cellX, point.cellY, tileSize, tileSize,
          x - size / 2, y - size / 2, size, size);
      }
      if (drawTarget) {
        context.globalAlpha = luminance * progress;
        context.drawImage(sprite!, x - size / 2, y - size / 2, size, size);
      }
      if (additive) context.globalCompositeOperation = 'source-over';
    }
    context.globalAlpha = 1;
    for (const region of readability) {
      if (region.bounds.right <= region.bounds.left || region.bounds.bottom <= region.bounds.top) continue;
      // Density fades can rise faster than the original waves. Observe the
      // actual draw every frame; refresh immediately if it exceeds the last
      // headroom. Falling values retain the capped release cadence.
      if (refreshReadability || region.light > region.appliedLight) {
        const light = Math.min(1, region.light + 0.2).toFixed(3);
        if (region.element.style.getPropertyValue('--home-background-luminance') !== light) {
          region.element.style.setProperty('--home-background-luminance', light);
        }
        region.appliedLight = Number(light);
      }
    }
    if (refreshReadability) lastReadability = seconds;
    readabilityNeeded = false;
    // Lightweight DOM-backed diagnostics for read-only browser verification.
    // At most ~8 updates/second while a transition is changing, none when stable.
    if (lastDiagnostics < 0 || seconds - lastDiagnostics >= 0.12 || motion.matches) {
      if (canvas.dataset.transitionPending !== String(pending)) canvas.dataset.transitionPending = String(pending);
      if (canvas.dataset.transitionActive !== String(active)) canvas.dataset.transitionActive = String(active);
      lastDiagnostics = seconds;
    }
  };

  const updatePopulation = (elapsed: number, immediate = false) => {
    for (const point of points) {
      if (immediate) point.presence = point.targetPresent ? 1 : 0;
      else advancePointPresence(point, point.targetPresent, elapsed);
    }
    while (points.length > targetPointCount && points[points.length - 1].presence === 0) points.pop();
    if (canvas.dataset.pointCount !== String(points.length)) canvas.dataset.pointCount = String(points.length);
  };

  const staticDraw = () => {
    updateTarget();
    for (const point of points) {
      point.transition = createGlyphTransition(target, seconds);
      point.fromHasGlyph = false;
    }
    draw();
  };

  const tick = (time: number) => {
    frame = 0;
    if (disposed || pageHidden || document.hidden || motion.matches) return;
    if (!lastDraw || time - lastDraw >= 1000 / 30) {
      const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.1) : 0;
      seconds += delta;
      advanceFieldMotion(fieldMotion, delta, width, height);
      updatePopulation(delta);
      previousTime = time;
      lastDraw = time;
      if (hitTestNeeded || target) updateTarget();
      draw();
    }
    frame = window.requestAnimationFrame(tick);
  };

  const stop = () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
    previousTime = lastDraw = 0;
  };

  const start = () => {
    if (disposed || pageHidden || document.hidden) return;
    canvas.dataset.renderMode = motion.matches ? 'static' : 'animated';
    if (motion.matches) staticDraw();
    else if (!frame) frame = window.requestAnimationFrame(tick);
  };

  const resize = () => {
    const geometryChanged = width !== window.innerWidth || height !== window.innerHeight;
    width = window.innerWidth;
    height = window.innerHeight;
    advanceFieldMotion(fieldMotion, 0, width, height);
    readabilityBoundsDirty = readabilityNeeded = true;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const previousPoints = points;
    const initial = previousPoints.length === 0;
    targetPointCount = pointCount(width, height);
    const grid = makePoints(width, height, Math.max(previousPoints.length, targetPointCount));
    canvas.dataset.targetPointCount = String(targetPointCount);
    const { width: atlasWidth, height: atlasHeight, columns, bytes } = glyphAtlasLayout(grid.length);
    for (const atlas of [sourceAtlas, captureAtlas]) {
      atlas.image.width = atlasWidth;
      atlas.image.height = atlasHeight;
    }
    // Resized/new points start at the latest target, with no stale cell pixels or
    // old deadlines. A fresh hit test then handles text moving under the pointer.
    points = grid.map((point, index) => ({
      ...point,
      presence: previousPoints[index]?.presence ?? (initial || motion.matches ? 1 : 0),
      targetPresent: index < targetPointCount,
      cellX: index % columns * tileSize,
      cellY: Math.floor(index / columns) * tileSize,
      fromHasGlyph: false,
      transition: createGlyphTransition(target, seconds),
    }));
    canvas.dataset.pointCount = String(points.length);
    canvas.dataset.transitionAtlasBytes = String(bytes);
    lastDiagnostics = -1;
    hitTestNeeded = true;
    // Reduced-motion geometry changes settle membership even while hidden;
    // visibility resumption must not retain a frozen, obsolete retiring tail.
    if (motion.matches && geometryChanged) updatePopulation(0, true);
    if (!document.hidden && !pageHidden) {
      if (motion.matches) staticDraw();
      else draw();
    }
  };

  const pointerChanged = () => {
    hitTestNeeded = true;
    readabilityNeeded = true;
    if (motion.matches && !document.hidden && !pageHidden) staticDraw();
  };
  const unsubscribe = subscribeCursorPointer(pointerChanged);
  // Text can move beneath a stationary cursor when the page/rotary scrolls.
  const scroll = () => { readabilityBoundsDirty = true; pointerChanged(); };
  const leave = () => { clearCursorPointer(); };
  const visibility = () => {
    if (document.hidden) {
      stop();
      clearCursorPointer();
    } else {
      hitTestNeeded = true;
      start();
    }
  };
  const motionChanged = () => {
    stop();
    // Freeze at the current phase/position; toggling the preference must not
    // reset the field phases or snap the shared translation back to its origin.
    start();
  };
  const pageHide = () => { pageHidden = true; stop(); };
  const pageShow = () => {
    pageHidden = false;
    hitTestNeeded = readabilityBoundsDirty = readabilityNeeded = true;
    start();
  };

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    stop();
    unsubscribe();
    for (const sprite of sprites.values()) sprite.width = sprite.height = 0;
    sprites.clear();
    points = [];
    for (const { element, previous } of readability) {
      if (previous) element.style.setProperty('--home-background-luminance', previous);
      else element.style.removeProperty('--home-background-luminance');
    }
    for (const atlas of [sourceAtlas, captureAtlas]) atlas.image.width = atlas.image.height = 0;
    window.removeEventListener('resize', resize);
    window.removeEventListener('scroll', scroll, true);
    window.removeEventListener('blur', leave);
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', pageShow);
    document.documentElement.removeEventListener('mouseleave', leave);
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('astro:before-swap', cleanup);
    motion.removeEventListener('change', motionChanged);
  };

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('scroll', scroll, { passive: true, capture: true });
  window.addEventListener('blur', leave);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  document.documentElement.addEventListener('mouseleave', leave);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('astro:before-swap', cleanup);
  motion.addEventListener('change', motionChanged);
  resize();
  start();
  return cleanup;
}
