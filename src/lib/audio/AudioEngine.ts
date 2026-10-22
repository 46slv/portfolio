/** Raw signal analysis. No distortion, filtering, delay, or visualization gain in the audio path. */
export class AudioEngine {
  readonly audioCtx: AudioContext;
  readonly analyser: AnalyserNode;
  readonly frequencyAnalyser: AnalyserNode;
  readonly leftAnalyser: AnalyserNode;
  readonly rightAnalyser: AnalyserNode;
  readonly monitorGain: GainNode;
  private readonly sink: GainNode;
  private readonly splitter: ChannelSplitterNode;
  private source?: MediaStreamAudioSourceNode;
  private stream?: MediaStream;
  private generation = 0;
  private disposed = false;
  monoInput = false;
  onInputEnded?: () => void;
  private trackListeners: (() => void)[] = [];
  private media: Pick<MediaDevices, 'getUserMedia'>;
  constructor(fftSize = 1024, context?: AudioContext, media: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices) {
    this.media = media;
    this.audioCtx = context ?? new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.frequencyAnalyser = this.audioCtx.createAnalyser();
    this.leftAnalyser = this.audioCtx.createAnalyser();
    this.rightAnalyser = this.audioCtx.createAnalyser();
    this.setFftSize(fftSize);
    this.analyser.smoothingTimeConstant = 0;
    this.leftAnalyser.smoothingTimeConstant = 0;
    this.rightAnalyser.smoothingTimeConstant = 0;
    this.frequencyAnalyser.smoothingTimeConstant = 0.65;
    this.monitorGain = this.audioCtx.createGain();
    this.monitorGain.gain.value = 0;
    this.monitorGain.connect(this.audioCtx.destination);
    this.sink = this.audioCtx.createGain();
    this.sink.gain.value = 0; // exactly silent analysis sink, not a near-silent keepalive
    this.sink.connect(this.audioCtx.destination);
    this.splitter = this.audioCtx.createChannelSplitter(2);
    this.splitter.connect(this.leftAnalyser, 0);
    this.splitter.connect(this.rightAnalyser, 1);
    for (const analyser of [this.analyser, this.frequencyAnalyser, this.leftAnalyser, this.rightAnalyser]) analyser.connect(this.sink);
  }
  setFftSize(size: number) {
    this.analyser.fftSize = size;
    this.leftAnalyser.fftSize = size;
    this.rightAnalyser.fftSize = size;
    this.frequencyAnalyser.fftSize = size * 2;
  }
  async initInput(deviceId?: string) {
    this.stopInput();
    if (this.disposed) return false;
    const generation = this.generation;
    // Called directly from the microphone click, before awaiting the permission request.
    const resumed = this.audioCtx.resume().then(() => null, (error: unknown) => error);
    let stream: MediaStream;
    try {
      stream = await this.media.getUserMedia({ audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: { ideal: 2 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      } });
    } catch (error) {
      if (generation !== this.generation || this.disposed) return false;
      throw error;
    }
    // Own the stream as soon as it arrives, even if resume is still pending.
    // Stop/hidden must be able to stop hardware capture without waiting for AudioContext.
    if (this.disposed || generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return false; }
    this.stream = stream;
    const resumeError = await resumed;
    if (this.disposed || generation !== this.generation || resumeError) {
      if (this.stream === stream) { this.stream = undefined; stream.getTracks().forEach((track) => track.stop()); }
      if (resumeError && generation === this.generation && !this.disposed) throw resumeError;
      return false;
    }
    if (stream.getAudioTracks().some((track) => track.readyState === 'ended')) {
      this.stopInput(); throw new Error('Microphone stopped before it could start. Please try again.');
    }
    // Duplicate L only for an explicitly reported mono device. Unknown/stereo silent R is real silence.
    this.monoInput = stream.getAudioTracks()[0]?.getSettings().channelCount === 1;
    for (const track of stream.getAudioTracks()) {
      const ended = () => {
        if (this.stream !== stream || this.disposed) return;
        this.stopInput(); this.onInputEnded?.();
      };
      track.addEventListener('ended', ended);
      this.trackListeners.push(() => track.removeEventListener('ended', ended));
    }
    this.source = this.audioCtx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
    this.source.connect(this.frequencyAnalyser);
    this.source.connect(this.splitter);
    this.source.connect(this.monitorGain);
    return true;
  }
  setMonitorLevel(level: number) { this.monitorGain.gain.value = Math.max(0, Math.min(1, level)); }
  fillTimeData(target: Float32Array<ArrayBuffer>) { this.analyser.getFloatTimeDomainData(target); }
  fillLissajousData(left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>) {
    this.leftAnalyser.getFloatTimeDomainData(left);
    if (this.monoInput) right.set(left); else this.rightAnalyser.getFloatTimeDomainData(right);
  }
  fillFrequencyData(target: Uint8Array<ArrayBuffer>) { this.frequencyAnalyser.getByteFrequencyData(target); }
  stopInput() {
    this.generation++;
    this.setMonitorLevel(0);
    this.trackListeners.forEach((remove) => remove()); this.trackListeners = [];
    this.source?.disconnect(); this.source = undefined;
    this.stream?.getTracks().forEach((track) => track.stop()); this.stream = undefined;
    this.monoInput = false;
  }
  async close() {
    if (this.disposed) return;
    this.disposed = true; this.stopInput();
    for (const node of [this.analyser, this.frequencyAnalyser, this.leftAnalyser, this.rightAnalyser, this.splitter, this.sink, this.monitorGain]) node.disconnect();
    await this.audioCtx.close();
  }
}
