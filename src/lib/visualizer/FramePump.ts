/** The only producer clock. A worker is a draw-on-message consumer, not a timer. */
export class FramePump {
  generation = 0;
  active = false;
  hidden = false;
  fps = 30;
  skippedBusy = 0;
  drawMs = 0;
  outputFps = 0;
  pending: { frameId: number; generation: number; since: number } | null = null;
  private id = 0;
  private next: number | null = null;
  private outputs: number[] = [];
  private heartbeat: number | null = null;
  private pendingHealthyMs = 0;
  invalidate() { this.heartbeat = null; this.generation++; this.next = null; this.outputs = []; this.outputFps = 0; }
  setActive(active: boolean) { if (this.active !== active) { this.active = active; this.invalidate(); } }
  setHidden(hidden: boolean) { if (this.hidden !== hidden) { this.hidden = hidden; this.invalidate(); } }
  resetTransport() { this.pending = null; this.pendingHealthyMs = 0; this.invalidate(); }
  issue(now: number) {
    if (!this.active || this.hidden || (this.next !== null && now + 0.25 < this.next)) return null;
    const interval = 1000 / this.fps;
    this.next = this.next === null ? now + interval
      : this.next + Math.max(1, Math.floor((now - this.next) / interval) + 1) * interval;
    if (this.pending) { this.skippedBusy++; return null; }
    this.pendingHealthyMs = 0;
    this.pending = { frameId: ++this.id, generation: this.generation, since: now };
    return this.pending;
  }
  shouldRecover(now: number) {
    if (!this.active || this.hidden) { this.heartbeat = null; return false; }
    const elapsed = this.heartbeat === null ? 0 : now - this.heartbeat;
    this.heartbeat = now;
    // A stalled browser/host is not evidence that its worker failed. Count only
    // elapsed time while the main producer itself is receiving timely RAF ticks.
    if (this.pending && elapsed >= 0 && elapsed <= 250) this.pendingHealthyMs += elapsed;
    return Boolean(this.pending && this.pendingHealthyMs > 2000);
  }
  expireOutputs(now: number) {
    this.outputs = this.outputs.filter((time) => time > now - 1000);
    this.outputFps = this.active && !this.hidden ? this.outputs.length : 0;
  }
  ack(frameId: number, generation: number, drawMs: number, now: number) {
    if (this.pending?.frameId !== frameId || this.pending.generation !== generation) return false;
    this.pending = null; this.pendingHealthyMs = 0;
    if (generation !== this.generation || !this.active || this.hidden) return false;
    this.drawMs = Math.max(0, drawMs);
    this.outputs.push(now);
    this.expireOutputs(now); // acknowledged outputs in the last second, not hardware refresh rate
    return true;
  }
}
