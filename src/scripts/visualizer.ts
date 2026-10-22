import { AudioEngine } from '../lib/audio/AudioEngine.ts';
import { MODES, QUALITIES, backingSize, defaultSettings, colorRgb } from '../lib/visualizer/model.ts';
import type { AudioFrame, Mode, ModeControl, Quality } from '../lib/visualizer/model.ts';
import { correlation, demoPcm, frequencyBands, rms } from '../lib/visualizer/analysis.ts';
import type { DemoPreset } from '../lib/visualizer/analysis.ts';
import { FramePump } from '../lib/visualizer/FramePump.ts';
import { SourceController } from '../lib/visualizer/SourceController.ts';
import { RenderTransport } from '../lib/visualizer/RenderTransport.ts';
import { bindColorControls } from '../lib/visualizer/ColorControls.ts';

export function mountVisualizer(root: HTMLElement) {
  const get = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const listeners = new AbortController();
  const on = (target: EventTarget, type: string, handler: EventListener) => target.addEventListener(type, handler, { signal: listeners.signal });
  const settings = defaultSettings();
  const pump = new FramePump();
  let raf = 0, disposed = false, focused = false, lastMetricAt = 0;
  let presentationNow = 0, lastTick = 0;
  let size = { width: 1, height: 1 };
  let buffers = makeBuffers();
  function makeBuffers() {
    const size = QUALITIES[settings.quality].fft;
    return { mono: new Float32Array(size), left: new Float32Array(size), right: new Float32Array(size),
      rawFrequency: new Uint8Array(size), bands: new Uint8Array(QUALITIES[settings.quality].bands) };
  }
  const source = new SourceController(() => new AudioEngine(QUALITIES[settings.quality].fft), sourceChanged);
  const transport = new RenderTransport(get<HTMLCanvasElement>('visualizer-canvas'), (ack) => {
    pump.ack(ack.frameId, ack.generation, ack.drawMs, performance.now());
  }, (notice) => {
    // The constructor can synchronously choose fallback before transport is assigned.
    queueMicrotask(() => { if (disposed) return; pump.resetTransport(); get('renderer-notice').textContent = notice; get('renderer-notice').hidden = false; });
  });
  const color = bindColorControls(root, (state, rgb) => { settings.color = state.color; settings.rgb = rgb; });
  settings.color = color.state.color;
  // ColorControls preserves exact presets; initialize the renderer from that same state.
  settings.rgb = colorRgb(color.state);
  function schedule() {
    cancelAnimationFrame(raf); raf = 0; lastTick = 0;
    if (!disposed && pump.active && !pump.hidden) raf = requestAnimationFrame(tick);
  }
  function sourceChanged() {
    const active = source.state === 'mic' || source.state === 'demo';
    pump.setActive(active); pump.invalidate(); presentationNow = 0;
    if (!active) transport.reset();
    get<HTMLButtonElement>('mic-btn').disabled = source.state === 'requesting';
    get<HTMLButtonElement>('stop-btn').disabled = source.state === 'idle' || source.state === 'error' || source.state === 'disposed';
    const monitor = get<HTMLInputElement>('monitor'); monitor.disabled = source.state !== 'mic';
    monitor.value = '0'; get<HTMLOutputElement>('monitor-value').value = 'Muted'; source.engine?.setMonitorLevel(0);
    const labels = { idle: 'Idle · choose a source', requesting: 'Waiting for microphone permission…', mic: 'Microphone · live', demo: 'Demo · silent generated signal', error: 'Microphone unavailable · choose demo or retry', disposed: 'Stopped' };
    get('source-status').textContent = labels[source.state];
    const idle = get('idle-message'); idle.hidden = active;
    if (source.state === 'requesting' || source.state === 'error') {
      idle.querySelector('p')!.textContent = source.state === 'requesting' ? 'Waiting for microphone…' : 'Microphone could not start.';
      const hints = idle.querySelectorAll('span:not(.idle-mark)');
      hints[0].textContent = source.state === 'requesting' ? 'Allow access in your browser, or choose Stop.' : source.error || 'Check your browser permissions and try again.';
      hints[1].textContent = 'The demo works without microphone access.';
    } else {
      idle.querySelector('p')!.textContent = 'See the shape of sound.';
      const hints = idle.querySelectorAll('span:not(.idle-mark)');
      hints[0].textContent = 'Try the silent demo, or connect a microphone.';
      hints[1].textContent = 'No microphone access until you choose it.';
    }
    get('source-tag').textContent = source.state === 'demo' ? 'DEMO / NOT LIVE' : source.state === 'mic' ? 'LIVE INPUT' : 'NO SIGNAL';
    get('visualizer-canvas').setAttribute('aria-label', `${MODES[settings.mode].label} visualization. ${labels[source.state]}.`);
    if (!active) { get('metric-fps').textContent = '0 frames'; get('metric-rms').textContent = '—'; get('metric-phase').textContent = '—'; }
    schedule();
  }
  function resize() {
    if (disposed) return;
    const rect = get('visualizer-stage').getBoundingClientRect();
    size = backingSize(rect.width, rect.height, window.devicePixelRatio, settings.quality);
    transport.resize(size.width, size.height);
    get('metric-size').textContent = `${size.width} × ${size.height}`;
  }
  function setMode(mode: Mode) {
    settings.mode = mode; pump.invalidate(); transport.reset();
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    get<HTMLSelectElement>('more-mode').value = ['radial', 'waterfall', 'particle'].includes(mode) ? mode : '';
    root.querySelectorAll<HTMLElement>('[data-control]').forEach((control) => { control.hidden = !MODES[mode].controls.includes(control.dataset.control as ModeControl); });
    // Presentation-only modes do not expose meaningless line-width/glow controls.
    for (const id of ['beam', 'glow']) {
      const disabled = mode === 'waterfall' || mode === 'particle' || (mode === 'spectrum' && id === 'beam');
      get<HTMLInputElement>(id).disabled = disabled;
      get<HTMLInputElement>(id).hidden = disabled;
      root.querySelector<HTMLElement>(`label[for="${id}"]`)!.hidden = disabled;
    }
    get('mode-caption').textContent = MODES[mode].description;
    get('visualizer-canvas').setAttribute('aria-label', `${MODES[mode].label} audio visualization`);
  }
  function capture(now: number) {
    const audio: AudioFrame = {};
    const analysis = MODES[settings.mode].analysis;
    const diagnostics = get<HTMLDetailsElement>('diagnostics').open;
    if (source.state === 'demo') {
      if (analysis !== 'frequency' || diagnostics) {
        demoPcm(buffers.left, buffers.right, source.demo, presentationNow / 1000);
        for (let i = 0; i < buffers.mono.length; i++) buffers.mono[i] = (buffers.left[i] + buffers.right[i]) / 2;
      }
      if (analysis === 'stereo') { audio.left = buffers.left; audio.right = buffers.right; }
      else if (analysis === 'mono') audio.mono = buffers.mono;
      if (analysis === 'frequency') {
        buffers.rawFrequency.fill(0);
        const bin = Math.round(375 * buffers.rawFrequency.length * 2 / 48000);
        // Ideal downmixed demo magnitudes, consistent with the mono microphone analysis tap.
        buffers.rawFrequency[bin] = source.demo === 'antiphase' ? 0 : source.demo === 'phase90' ? 148 : source.demo === 'mono' ? 210 : 105;
        if (source.demo === 'ratio12') buffers.rawFrequency[bin * 2] = 105;
      }
    } else if (source.engine) {
      if (analysis === 'mono' || diagnostics) source.engine.fillTimeData(buffers.mono);
      if (analysis === 'mono') audio.mono = buffers.mono;
      if (analysis === 'stereo') { source.engine.fillLissajousData(buffers.left, buffers.right); audio.left = buffers.left; audio.right = buffers.right; }
      if (analysis === 'frequency') source.engine.fillFrequencyData(buffers.rawFrequency);
    }
    if (analysis === 'frequency') { frequencyBands(buffers.rawFrequency, buffers.bands); audio.frequency = buffers.bands; }
    if (diagnostics && now - lastMetricAt > 250) {
      const samples = analysis === 'stereo' ? buffers.left : buffers.mono;
      const level = rms(samples);
      get('metric-rms').textContent = `${level.toFixed(3)} / ${level ? (20 * Math.log10(level)).toFixed(1) : '−∞'} dBFS`;
      const phase = analysis === 'stereo' ? correlation(buffers.left, buffers.right) : null;
      get('metric-phase').textContent = phase === null ? '—' : phase.toFixed(3);
    }
    return audio;
  }
  function tick(now: number) {
    raf = 0;
    if (disposed || !pump.active || pump.hidden) return;
    if (lastTick) presentationNow += Math.min(100, now - lastTick);
    lastTick = now;
    if (pump.shouldRecover(now)) transport.fallback('Worker stopped acknowledging during active rendering. Canvas 2D fallback is active.');
    const issued = transport.ready ? pump.issue(now) : null;
    if (issued) {
      const audio = capture(now);
      try { transport.draw({ frameId: issued.frameId, generation: issued.generation, now: presentationNow, settings: { ...settings }, audio }); }
      catch { transport.fallback('Renderer recovered using Canvas 2D.'); pump.resetTransport(); }
    }
    if (now - lastMetricAt > 250) {
      pump.expireOutputs(now);
      get('metric-renderer').textContent = transport.kind;
      get('metric-fps').textContent = `${pump.outputFps} frames`;
      get('metric-draw').textContent = `${pump.drawMs.toFixed(2)} ms`;
      get('metric-busy').textContent = String(pump.skippedBusy);
      lastMetricAt = now;
    }
    raf = requestAnimationFrame(tick);
  }
  on(get('demo-btn'), 'click', () => source.startDemo(get<HTMLSelectElement>('demo-select').value as DemoPreset));
  on(get('mic-btn'), 'click', () => { void source.startMicrophone(get<HTMLSelectElement>('input-select').value).then(refreshDevices); });
  on(get('stop-btn'), 'click', () => source.stop());
  on(get('demo-select'), 'change', () => { source.demo = get<HTMLSelectElement>('demo-select').value as DemoPreset; if (source.state === 'demo') source.startDemo(); });
  on(get('input-select'), 'change', () => {
    if (source.state === 'mic' || source.state === 'requesting') { source.stop(); void source.startMicrophone(get<HTMLSelectElement>('input-select').value).then(refreshDevices); }
  });
  async function refreshDevices() {
    if (disposed || source.state !== 'mic') return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (disposed || source.state !== 'mic') return;
      const select = get<HTMLSelectElement>('input-select'); const previous = select.value;
      select.replaceChildren(new Option('System default', ''));
      devices.filter((device) => device.kind === 'audioinput').forEach((device, i) => select.add(new Option(device.label || `Microphone ${i + 1}`, device.deviceId)));
      select.value = previous;
    } catch { /* Device listing is optional; the current live input remains valid. */ }
  }
  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => on(button, 'click', () => setMode(button.dataset.mode as Mode)));
  on(get('more-mode'), 'change', () => { const value = get<HTMLSelectElement>('more-mode').value; if (value) setMode(value as Mode); });
  on(get('quality'), 'change', () => {
    settings.quality = get<HTMLSelectElement>('quality').value as Quality;
    pump.fps = QUALITIES[settings.quality].fps; pump.invalidate();
    source.engine?.setFftSize(QUALITIES[settings.quality].fft); buffers = makeBuffers(); resize();
  });
  const ranges = ['gain', 'beam', 'glow', 'trail'] as const;
  function renderRanges() {
    for (const id of ranges) {
      get<HTMLInputElement>(id).value = String(settings[id]);
      get<HTMLOutputElement>(`${id}-value`).value = id === 'gain' || id === 'beam' ? `${settings[id].toFixed(1)}×` : settings[id] ? `${settings[id].toFixed(2)}${id === 'trail' ? ' s' : ''}` : 'Off';
    }
  }
  for (const id of ranges) on(get(id), 'input', () => { settings[id] = Number(get<HTMLInputElement>(id).value); renderRanges(); });
  on(get('time-window'), 'change', () => { settings.window = Number(get<HTMLSelectElement>('time-window').value); });
  on(get('grid'), 'change', () => { settings.grid = get<HTMLInputElement>('grid').checked; });
  on(get('crt'), 'change', () => root.classList.toggle('crt', get<HTMLInputElement>('crt').checked));
  on(get('monitor'), 'input', () => {
    const level = source.state === 'mic' ? Number(get<HTMLInputElement>('monitor').value) : 0;
    source.engine?.setMonitorLevel(level); get<HTMLOutputElement>('monitor-value').value = level ? `${Math.round(level * 100)}%` : 'Muted';
  });
  function focus(active: boolean) {
    focused = active; root.classList.toggle('is-focused', active);
    get('focus-exit').hidden = !active; get('focus-btn').setAttribute('aria-pressed', String(active));
    (active ? get('focus-exit') : get('focus-btn')).focus(); resize();
  }
  on(get('focus-btn'), 'click', () => focus(!focused)); on(get('focus-exit'), 'click', () => focus(false));
  on(window, 'keydown', ((event: KeyboardEvent) => { if (event.key === 'Escape' && focused) focus(false); }) as EventListener);
  on(get('fullscreen-btn'), 'click', () => {
    const unavailable = () => {
      get('renderer-notice').textContent = 'Fullscreen is unavailable in this browser. Focus view is still available.';
      get('renderer-notice').hidden = false;
    };
    const exiting = Boolean(document.fullscreenElement);
    if ((exiting && typeof document.exitFullscreen !== 'function')
      || (!exiting && typeof root.requestFullscreen !== 'function')) { unavailable(); return; }
    try {
      const request = exiting ? document.exitFullscreen() : root.requestFullscreen();
      void Promise.resolve(request).catch(unavailable);
    } catch { unavailable(); }
  });
  on(document, 'fullscreenchange', () => { get('fullscreen-btn').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'; resize(); });
  on(get('reset-btn'), 'click', () => {
    Object.assign(settings, defaultSettings()); color.reset();
    get<HTMLSelectElement>('quality').value = settings.quality; pump.fps = QUALITIES[settings.quality].fps;
    source.engine?.setFftSize(QUALITIES[settings.quality].fft); buffers = makeBuffers();
    get<HTMLSelectElement>('time-window').value = String(settings.window); get<HTMLInputElement>('grid').checked = true;
    get<HTMLInputElement>('crt').checked = false; root.classList.remove('crt');
    renderRanges(); setMode('scope'); focus(false); resize();
  });
  on(document, 'visibilitychange', () => {
    pump.setHidden(document.hidden);
    if (!document.hidden && pump.pending) pump.pending.since = performance.now();
    // Stop hardware capture / a pending permission request when hidden. Demo only pauses.
    if (document.hidden) {
      if (source.state === 'mic' || source.state === 'requesting') {
        source.stop();
        get('source-status').textContent = 'Microphone stopped while hidden · choose Use microphone to restart';
        const idle = get('idle-message'); idle.querySelector('p')!.textContent = 'Microphone stopped for privacy.';
        const hints = idle.querySelectorAll('span:not(.idle-mark)');
        hints[0].textContent = 'This page stopped microphone access while it was hidden.';
        hints[1].textContent = 'Choose Use microphone to restart, or try the silent demo.';
      }
      transport.reset();
    }
    schedule();
  });
  const observer = new ResizeObserver(resize); observer.observe(get('visualizer-stage'));
  on(window, 'resize', resize);
  function cleanup() {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(raf); pump.setActive(false);
    observer.disconnect(); listeners.abort(); color.dispose(); transport.dispose(); void source.dispose();
  }
  on(document, 'astro:before-swap', cleanup);
  on(window, 'pagehide', ((event: PageTransitionEvent) => { if (event.persisted) source.stop(); else cleanup(); }) as EventListener);
  // BFCache restoration stays stopped and requires another deliberate source gesture.
  pump.setHidden(document.hidden); renderRanges(); resize(); setMode('scope'); sourceChanged();
  return cleanup;
}
