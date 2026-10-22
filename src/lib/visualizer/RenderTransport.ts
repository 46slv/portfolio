import { VisualizerRenderer } from './Renderer.ts';
import type { FrameAck, RenderFrame } from './model.ts';
/** Shared renderer in both paths. A transferred canvas must be replaced on worker failure. */
export class RenderTransport {
  private worker: Worker | null = null;
  private renderer: VisualizerRenderer | null = null;
  private transferred = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  ready = false;
  kind = 'Starting renderer';
  private width = 1;
  private height = 1;
  private canvas: HTMLCanvasElement;
  private ack: (ack: FrameAck) => void;
  private recovered: (notice: string) => void;
  constructor(canvas: HTMLCanvasElement, ack: (ack: FrameAck) => void,
    recovered: (notice: string) => void, createWorker: () => Worker = () =>
      new Worker(new URL('../../scripts/visualizer-worker.ts', import.meta.url), { type: 'module' })) {
    this.canvas = canvas; this.ack = ack; this.recovered = recovered;
    try {
      if (!canvas.transferControlToOffscreen) { this.fallback('Canvas 2D compatibility mode'); return; }
      this.worker = createWorker();
      this.worker.onmessage = (event: MessageEvent<FrameAck | { type: 'ready' | 'error' }>) => {
        if (this.disposed) return;
        if (event.data.type === 'ready') { clearTimeout(this.timer); this.ready = true; this.kind = 'Canvas 2D · worker'; }
        else if (event.data.type === 'ack') this.ack(event.data);
        else this.fallback('Worker unavailable. Canvas 2D fallback is active.');
      };
      this.worker.onerror = (event) => { event.preventDefault(); this.fallback('Worker failed. Canvas 2D fallback is active.'); };
      this.worker.onmessageerror = () => this.fallback('Worker communication failed. Canvas 2D fallback is active.');
      const offscreen = canvas.transferControlToOffscreen(); this.transferred = true;
      this.worker.postMessage({ type: 'init', canvas: offscreen, width: this.width, height: this.height }, [offscreen]);
      this.timer = setTimeout(() => this.fallback('Worker did not start. Canvas 2D fallback is active.'), 2000);
    } catch { this.fallback('Canvas 2D fallback is active.'); }
  }
  fallback(notice: string) {
    if (this.disposed || this.renderer) return;
    clearTimeout(this.timer); this.worker?.terminate(); this.worker = null;
    if (this.transferred) {
      const replacement = this.canvas.cloneNode(false) as HTMLCanvasElement;
      this.canvas.replaceWith(replacement); this.canvas = replacement; this.transferred = false;
    }
    this.renderer = new VisualizerRenderer(this.canvas); this.renderer.resize(this.width, this.height);
    this.ready = true; this.kind = 'Canvas 2D · main thread'; this.recovered(notice);
  }
  resize(width: number, height: number) {
    this.width = width; this.height = height;
    if (this.renderer) this.renderer.resize(width, height);
    else this.worker?.postMessage({ type: 'resize', width, height });
  }
  draw(frame: RenderFrame) {
    if (!this.ready || this.disposed) return;
    if (this.worker) this.worker.postMessage({ type: 'frame', frame });
    else if (this.renderer) {
      const start = performance.now(); this.renderer.draw(frame);
      this.ack({ type: 'ack', frameId: frame.frameId, generation: frame.generation, drawMs: performance.now() - start });
    }
  }
  reset() { if (this.renderer) this.renderer.reset(); else this.worker?.postMessage({ type: 'reset' }); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; clearTimeout(this.timer);
    this.worker?.terminate(); this.worker = null; this.renderer?.dispose(); this.renderer = null; this.ready = false;
  }
}
