import { AudioEngine } from '../audio/AudioEngine.ts';
import type { DemoPreset } from './analysis.ts';
export type SourceState = 'idle' | 'requesting' | 'mic' | 'demo' | 'error' | 'disposed';
export class SourceController {
  state: SourceState = 'idle';
  error = '';
  demo: DemoPreset = 'phase90';
  engine: AudioEngine | null = null;
  private generation = 0;
  private createEngine: () => AudioEngine;
  private change: () => void;
  constructor(createEngine: () => AudioEngine, change: () => void) { this.createEngine = createEngine; this.change = change; }
  private transition(state: SourceState) { this.state = state; this.change(); }
  async startMicrophone(deviceId?: string) {
    if (this.state === 'disposed' || this.state === 'requesting') return;
    this.stop();
    const generation = ++this.generation;
    this.error = ''; this.transition('requesting');
    try {
      this.engine ??= this.createEngine();
      this.engine.onInputEnded = () => {
        if (this.state !== 'mic') return;
        this.stop(); this.error = 'Microphone disconnected or sharing stopped. Choose a source to restart.'; this.transition('error');
      };
      const started = await this.engine.initInput(deviceId);
      if (generation !== this.generation) return;
      if (started) this.transition('mic'); else this.transition('idle');
    } catch (error) {
      if (generation !== this.generation) return;
      this.engine?.stopInput();
      this.error = error instanceof Error ? error.message : 'Microphone unavailable';
      this.transition('error');
    }
  }
  startDemo(preset: DemoPreset = this.demo) {
    if (this.state === 'disposed') return;
    this.stop(); this.demo = preset; this.transition('demo');
  }
  stop() {
    if (this.state === 'disposed') return;
    this.generation++; this.engine?.stopInput(); this.transition('idle');
  }
  async dispose() {
    if (this.state === 'disposed') return;
    this.stop(); this.transition('disposed'); await this.engine?.close();
  }
}
