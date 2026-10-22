import { VisualizerRenderer } from '../lib/visualizer/Renderer.ts';
import type { RenderFrame } from '../lib/visualizer/model.ts';
let renderer: VisualizerRenderer | null = null;
// Intentionally no RAF/setTimeout loop: one input frame produces one measured output ACK.
self.onmessage = (event: MessageEvent<
  | { type: 'init'; canvas: OffscreenCanvas; width: number; height: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'reset' }
  | { type: 'dispose' }
  | { type: 'frame'; frame: RenderFrame }
>) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      renderer = new VisualizerRenderer(message.canvas); renderer.resize(message.width, message.height);
      self.postMessage({ type: 'ready' });
    } else if (message.type === 'resize') renderer?.resize(message.width, message.height);
    else if (message.type === 'reset') renderer?.reset();
    else if (message.type === 'dispose') { renderer?.dispose(); renderer = null; self.close(); }
    else if (message.type === 'frame' && renderer) {
      const start = performance.now(); renderer.draw(message.frame);
      self.postMessage({ type: 'ack', frameId: message.frame.frameId, generation: message.frame.generation, drawMs: performance.now() - start });
    }
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Renderer failed' }); }
};
