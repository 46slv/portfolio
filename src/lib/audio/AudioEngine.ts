export class AudioEngine {
  audioCtx: AudioContext;

  analyser: AnalyserNode;
  frequencyAnalyser: AnalyserNode;

  inputGain: GainNode;
  monitorGain: GainNode;

  filterNode: BiquadFilterNode;

  distortionNode: WaveShaperNode;

  delayNode: DelayNode;
  delayGain: GainNode;

  sourceNode?: MediaStreamAudioSourceNode;

  stream?: MediaStream;

  constructor() {
    this.audioCtx =
      new AudioContext();

    /*
    ----------------------------
    ANALYSERS
    ----------------------------
    */

    this.analyser =
      this.audioCtx.createAnalyser();

    this.analyser.fftSize = 2048;

    this.analyser.smoothingTimeConstant =
      0.82;

    this.frequencyAnalyser =
      this.audioCtx.createAnalyser();

    this.frequencyAnalyser.fftSize =
      4096;

    /*
    ----------------------------
    DSP NODES
    ----------------------------
    */

    this.inputGain =
      this.audioCtx.createGain();

    this.monitorGain =
      this.audioCtx.createGain();

    this.monitorGain.gain.value = 0;

    this.filterNode =
      this.audioCtx.createBiquadFilter();

    this.filterNode.type = "lowpass";

    this.filterNode.frequency.value =
      20000;

    this.distortionNode =
      this.audioCtx.createWaveShaper();

    this.delayNode =
      this.audioCtx.createDelay();

    this.delayNode.delayTime.value =
      0.25;

    this.delayGain =
      this.audioCtx.createGain();

    this.delayGain.gain.value = 0;

    /*
    ----------------------------
    GRAPH
    ----------------------------
    */

    this.inputGain.connect(
      this.distortionNode
    );

    this.distortionNode.connect(
      this.filterNode
    );

    this.filterNode.connect(
      this.delayNode
    );

    this.delayNode.connect(
      this.delayGain
    );

    this.delayGain.connect(
      this.analyser
    );

    this.delayGain.connect(
      this.frequencyAnalyser
    );

    this.analyser.connect(
      this.monitorGain
    );

    this.monitorGain.connect(
      this.audioCtx.destination
    );
  }

  /*
  --------------------------------
  INPUT DEVICE
  --------------------------------
  */

  async initInput(
    deviceId?: string
  ) {
    if (this.stream) {
      this.stream
        .getTracks()
        .forEach(t => t.stop());
    }

    this.stream =
      await navigator.mediaDevices
        .getUserMedia({
          audio: {
            deviceId: deviceId
              ? { exact: deviceId }
              : undefined
          }
        });

    this.sourceNode =
      this.audioCtx
        .createMediaStreamSource(
          this.stream
        );

    this.sourceNode.connect(
      this.inputGain
    );
  }

  /*
  --------------------------------
  DEVICES
  --------------------------------
  */

  async getInputDevices() {
    const devices =
      await navigator.mediaDevices
        .enumerateDevices();

    return devices.filter(
      d => d.kind === "audioinput"
    );
  }

  /*
  --------------------------------
  MONITOR
  --------------------------------
  */

  setMonitorEnabled(
    enabled: boolean
  ) {
    if (!enabled) {
      this.monitorGain.gain.value = 0;
    }
  }

  setMonitorLevel(level: number) {
    this.monitorGain.gain.value =
      level;
  }

  /*
  --------------------------------
  FILTER
  --------------------------------
  */

  setLPF(freq: number) {
    this.filterNode.frequency.value =
      freq;
  }

  /*
  --------------------------------
  DELAY
  --------------------------------
  */

  setDelayMix(amount: number) {
    this.delayGain.gain.value =
      amount;
  }

  /*
  --------------------------------
  DISTORTION
  --------------------------------
  */

  setDistortion(amount: number) {
    this.distortionNode.curve =
      this.makeDistortionCurve(
        amount * 100
      );
  }

  makeDistortionCurve(
    amount: number
  ) {
    const samples = 44100;

    const curve =
      new Float32Array(samples);

    for (
      let i = 0;
      i < samples;
      i++
    ) {
      const x =
        (i * 2 / samples) - 1;

      curve[i] =
        ((3 + amount) *
          x *
          20 *
          Math.PI /
          180) /
        (
          Math.PI +
          amount *
          Math.abs(x)
        );
    }

    return curve;
  }

  /*
  --------------------------------
  DATA ACCESS
  --------------------------------
  */

  getTimeData() {
    const data =
      new Uint8Array(
        this.analyser.fftSize
      );

    this.analyser
      .getByteTimeDomainData(data);

    return data;
  }

  getFrequencyData() {
    const data =
      new Uint8Array(
        this.frequencyAnalyser
          .frequencyBinCount
      );

    this.frequencyAnalyser
      .getByteFrequencyData(data);

    return data;
  }
}