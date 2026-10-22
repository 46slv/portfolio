import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioEngine } from '../src/lib/audio/AudioEngine.ts';
import { SourceController } from '../src/lib/visualizer/SourceController.ts';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
class Node {
  gain = { value: 1 }; connections = []; disconnected = false; fftSize = 2048;
  connect(...args) { this.connections.push(args); }
  disconnect() { this.disconnected = true; this.connections = []; }
  getFloatTimeDomainData(target) { target.fill(this.sample ?? 0); }
  getByteFrequencyData(target) { target.fill(0); }
}
class Context {
  destination = new Node(); nodes = []; state = 'running'; sampleRate = 48000; closed = false;
  createAnalyser() { const node = new Node(); this.nodes.push(node); return node; }
  createGain() { const node = new Node(); this.nodes.push(node); return node; }
  createChannelSplitter() { const node = new Node(); this.nodes.push(node); return node; }
  createMediaStreamSource(stream) { const node = new Node(); node.stream = stream; this.nodes.push(node); return node; }
  resume() { return this.resumeResult ?? Promise.resolve(); }
  async close() { this.closed = true; }
}
function stream(channels = 2) {
  const track = Object.assign(new EventTarget(), { stopped: 0, getSettings: () => ({ channelCount: channels }), stop() { this.stopped++; } });
  return { getTracks: () => [track], getAudioTracks: () => [track], track };
}
function setup() {
  const context = new Context(), requests = [];
  const media = { getUserMedia(constraints) { const request = deferred(); requests.push({ ...request, constraints }); return request.promise; } };
  const engine = new AudioEngine(1024, context, media);
  return { engine, context, requests };
}
test('raw graph applies FFT at construction, keeps every output path exactly muted and has no effect nodes', () => {
  const { engine, context } = setup();
  assert.equal(engine.analyser.fftSize, 1024); assert.equal(engine.leftAnalyser.fftSize, 1024); assert.equal(engine.rightAnalyser.fftSize, 1024); assert.equal(engine.frequencyAnalyser.fftSize, 2048);
  assert.equal(engine.monitorGain.gain.value, 0);
  for (const node of context.nodes.filter((node) => node.connections.some(([target]) => target === context.destination))) assert.equal(node.gain.value, 0);
  engine.setFftSize(2048); assert.equal(engine.frequencyAnalyser.fftSize, 4096);
});
test('STOP during deferred getUserMedia stops the stale stream and never connects it', async () => {
  const { engine, requests, context } = setup(); const starting = engine.initInput(); engine.stopInput(); const stale = stream(); requests[0].resolve(stale);
  assert.equal(await starting, false); assert.equal(stale.track.stopped, 1); assert.ok(!context.nodes.some((node) => node.stream)); assert.equal(engine.monitorGain.gain.value, 0);
});
test('rapid source changes/repeated starts cannot install an older stream over a newer one', async () => {
  const { engine, requests, context } = setup(); const first = engine.initInput('first'), second = engine.initInput('second'); const older = stream(), newer = stream();
  requests[1].resolve(newer); assert.equal(await second, true); requests[0].resolve(older); assert.equal(await first, false);
  assert.equal(older.track.stopped, 1); assert.equal(newer.track.stopped, 0);
  const sources = context.nodes.filter((node) => node.stream); assert.equal(sources.length, 1); assert.equal(sources[0].stream, newer);
  assert.deepEqual(requests[1].constraints.audio.deviceId, { exact: 'second' }); engine.stopInput(); assert.equal(newer.track.stopped, 1); assert.equal(sources[0].disconnected, true);
});
test('permission rejection recovers and can be retried, with no audible monitor', async () => {
  const { engine, requests } = setup(); const first = engine.initInput(); requests[0].reject(new Error('Permission denied')); await assert.rejects(first, /Permission denied/);
  const retry = engine.initInput(); requests[1].resolve(stream()); assert.equal(await retry, true); assert.equal(engine.monitorGain.gain.value, 0);
  engine.setMonitorLevel(0.4); assert.equal(engine.monitorGain.gain.value, 0.4); engine.stopInput(); assert.equal(engine.monitorGain.gain.value, 0);
});
test('explicit mono duplicates L but stereo and unknown-channel silent R are preserved', async () => {
  for (const channels of [1, 2, undefined]) {
    const { engine, requests } = setup(); const start = engine.initInput(); const input = stream(channels);
    if (channels === undefined) input.track.getSettings = () => ({});
    requests[0].resolve(input); await start;
    engine.leftAnalyser.sample = 0.5; engine.rightAnalyser.sample = 0;
    const left = new Float32Array(8), right = new Float32Array(8); engine.fillLissajousData(left, right);
    assert.ok(left.every((v) => v === 0.5)); assert.ok(right.every((v) => v === (channels === 1 ? 0.5 : 0)));
    await engine.close();
  }
});
test('cleanup during permission request closes context, disconnects nodes and stops late stream once', async () => {
  const { engine, context, requests } = setup(); const pending = engine.initInput(); await engine.close(); const late = stream(); requests[0].resolve(late);
  assert.equal(await pending, false); assert.equal(late.track.stopped, 1); assert.equal(context.closed, true); assert.ok(context.nodes.every((node) => node.disconnected)); await engine.close();
});
test('AudioContext resume failure also stops the successfully acquired stream', async () => {
  const { engine, context, requests } = setup(); context.resumeResult = Promise.reject(new Error('Resume failed'));
  const pending = engine.initInput(); const input = stream(); requests[0].resolve(input); await assert.rejects(pending, /Resume failed/); assert.equal(input.track.stopped, 1);
});
test('device ending stops analysis source and reports the ended signal without recursive stop events', async () => {
  const { engine, requests } = setup(); let ended = 0; engine.onInputEnded = () => ended++;
  const pending = engine.initInput(); const input = stream(); requests[0].resolve(input); await pending;
  input.track.dispatchEvent(new Event('ended')); assert.equal(ended, 1); assert.equal(input.track.stopped, 1); assert.equal(engine.monitorGain.gain.value, 0);
  input.track.dispatchEvent(new Event('ended')); assert.equal(ended, 1);
});
test('source controller remains explicit idle/requesting/mic/demo/error/disposed across interrupted and repeated flows', async () => {
  const { engine, requests } = setup(); const states = []; let made = 0;
  const source = new SourceController(() => { made++; return engine; }, () => states.push(source.state));
  assert.equal(source.state, 'idle'); source.startDemo('mono'); assert.equal(source.state, 'demo'); assert.equal(made, 0, 'demo must not create AudioContext or request permission');
  source.stop(); assert.equal(source.state, 'idle'); const pending = source.startMicrophone(); assert.equal(source.state, 'requesting');
  await source.startMicrophone(); assert.equal(requests.length, 1, 'repeated pending Start is ignored');
  source.startDemo('silentRight'); const late = stream(); requests[0].resolve(late); await pending;
  assert.equal(late.track.stopped, 1); assert.equal(source.state, 'demo'); assert.equal(source.demo, 'silentRight');
  const denied = source.startMicrophone(); requests[1].reject(new Error('Denied')); await denied; assert.equal(source.state, 'error');
  const retry = source.startMicrophone(); requests[2].resolve(stream()); await retry; assert.equal(source.state, 'mic'); engine.onInputEnded(); assert.equal(source.state, 'error');
  await source.dispose(); assert.equal(source.state, 'disposed'); source.startDemo(); await source.startMicrophone(); assert.equal(source.state, 'disposed');
  assert.ok(states.includes('requesting') && states.includes('mic') && states.includes('error'));
});
test('source controller Stop suppresses a late permission rejection and hidden behavior explicitly stops pending/live input', async () => {
  const { engine, requests } = setup(); const source = new SourceController(() => engine, () => {});
  const pending = source.startMicrophone(); source.stop(); requests[0].reject(new Error('Late denied')); await pending; assert.equal(source.state, 'idle');
  const script = await (await import('node:fs/promises')).readFile(new URL('../src/scripts/visualizer.ts', import.meta.url), 'utf8');
  assert.match(script, /if \(source\.state === 'mic' \|\| source\.state === 'requesting'\) \{\s+source\.stop\(\)/);
});

test('Stop owns and stops returned media immediately even while AudioContext resume remains pending', async () => {
  const { engine, context, requests } = setup(); const resume = deferred(); context.resumeResult = resume.promise;
  const pending = engine.initInput(); const input = stream(); requests[0].resolve(input);
  await new Promise((resolve) => setImmediate(resolve)); engine.stopInput();
  assert.equal(input.track.stopped, 1, 'hardware capture is stopped before resume can settle');
  resume.resolve(); assert.equal(await pending, false); assert.equal(input.track.stopped, 1);
});
test('Stop before media arrival also stops stale tracks without waiting for a pending resume', async () => {
  const { engine, context, requests } = setup(); const resume = deferred(); context.resumeResult = resume.promise;
  const pending = engine.initInput(); engine.stopInput(); const input = stream(); requests[0].resolve(input);
  assert.equal(await pending, false); assert.equal(input.track.stopped, 1); resume.resolve();
});
