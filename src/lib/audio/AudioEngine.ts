// src/lib/audio/AudioEngine.ts
// SS_SCOPE v4 Audio Engine

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
    --------------------------------
    ANALYSERS
    --------------------------------
    */

    this.analyser =
      this.audioCtx
        .createAnalyser();

    this.analyser.fftSize =
      2048;

    this.analyser.smoothingTimeConstant =
      0.82;

    this.frequencyAnalyser =
      this.audioCtx
        .createAnalyser();

    this.frequencyAnalyser.fftSize =
      4096;

    this.frequencyAnalyser.smoothingTimeConstant =
      0.86;

    /*
    --------------------------------
    DSP NODES
    --------------------------------
    */

    this.inputGain =
      this.audioCtx
        .createGain();

    this.inputGain.gain.value = 1;

    this.monitorGain =
      this.audioCtx
        .createGain();

    // default mute
    this.monitorGain.gain.value = 0;

    this.filterNode =
      this.audioCtx
        .createBiquadFilter();

    this.filterNode.type =
      'lowpass';

    this.filterNode.frequency.value =
      20000;

    this.filterNode.Q.value =
      0.0001;

    this.distortionNode =
      this.audioCtx
        .createWaveShaper();

    this.distortionNode.curve =
      this.makeDistortionCurve(0);

    this.distortionNode.oversample =
      '4x';

    this.delayNode =
      this.audioCtx
        .createDelay(2.0);

    this.delayNode.delayTime.value =
      0.25;

    this.delayGain =
      this.audioCtx
        .createGain();

    this.delayGain.gain.value =
      0;

    /*
    --------------------------------
    AUDIO GRAPH
    --------------------------------

    INPUT
      -> INPUT GAIN
      -> DISTORTION
      -> FILTER
      -> DELAY
      -> DELAY MIX
      -> ANALYSERS
      -> MONITOR
      -> OUTPUT

    --------------------------------
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

    // dry path
    this.filterNode.connect(
      this.analyser
    );

    this.filterNode.connect(
      this.frequencyAnalyser
    );

    // monitor routing
    this.analyser.connect(
      this.monitorGain
    );

    this.monitorGain.connect(
      this.audioCtx.destination
    );
  }

  /*
  --------------------------------
  INPUT INIT
  --------------------------------
  */

  async initInput(
    deviceId?: string
  ) {

    // cleanup previous stream

    if (this.stream) {

      this.stream
        .getTracks()
        .forEach(track => {
          track.stop();
        });
    }

    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        deviceId:
          deviceId
            ? { exact: deviceId }
            : undefined
      }
    };

    this.stream =
      await navigator
        .mediaDevices
        .getUserMedia(
          constraints
        );

    this.sourceNode =
      this.audioCtx
        .createMediaStreamSource(
          this.stream
        );

    this.sourceNode.connect(
      this.inputGain
    );

    if (
      this.audioCtx.state ===
      'suspended'
    ) {
      await this.audioCtx.resume();
    }
  }

  /*
  --------------------------------
  INPUT DEVICES
  --------------------------------
  */

  async getInputDevices() {

    const devices =
      await navigator
        .mediaDevices
        .enumerateDevices();

    return devices.filter(
      device =>
        device.kind ===
        'audioinput'
    );
  }

  /*
  --------------------------------
  MONITOR
  --------------------------------
  */

  setMonitorLevel(
    level: number
  ) {

    this.monitorGain.gain.value =
      level;
  }

  muteMonitor() {

    this.monitorGain.gain.value =
      0;
  }

  /*
  --------------------------------
  INPUT GAIN
  --------------------------------
  */

  setInputGain(
    amount: number
  ) {

    this.inputGain.gain.value =
      amount;
  }

  /*
  --------------------------------
  FILTER
  --------------------------------
  */

  setLPF(
    frequency: number
  ) {

    this.filterNode.frequency.value =
      frequency;
  }

  /*
  --------------------------------
  DELAY
  --------------------------------
  */

  setDelayMix(
    amount: number
  ) {

    this.delayGain.gain.value =
      amount;
  }

  setDelayTime(
    seconds: number
  ) {

    this.delayNode.delayTime.value =
      seconds;
  }

  /*
  --------------------------------
  DISTORTION
  --------------------------------
  */

  setDistortion(
    amount: number
  ) {

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
      new Float32Array(
        samples
      );

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
  ANALYSIS DATA
  --------------------------------
  */

  getTimeData() {

    const data =
      new Uint8Array(
        this.analyser
          .fftSize
      );

    this.analyser
      .getByteTimeDomainData(
        data
      );

    return data;
  }

  getFrequencyData() {

    const data =
      new Uint8Array(
        this.frequencyAnalyser
          .frequencyBinCount
      );

    this.frequencyAnalyser
      .getByteFrequencyData(
        data
      );

    return data;
  }

  /*
  --------------------------------
  RMS
  --------------------------------
  */

  getRMS() {

    const data =
      this.getTimeData();

    let sum = 0;

    for (
      let i = 0;
      i < data.length;
      i++
    ) {

      const v =
        (data[i] - 128) /
        128;

      sum += v * v;
    }

    return Math.sqrt(
      sum / data.length
    );
  }

  getRMSdB() {

    const rms =
      this.getRMS();

    return 20 * Math.log10(
      rms || 0.0001
    );
  }

  /*
  --------------------------------
  PEAK FREQUENCY
  --------------------------------
  */

  getPeakFrequency() {

    const freq =
      this.getFrequencyData();

    const peakIndex =
      freq.indexOf(
        Math.max(...freq)
      );

    return (
      peakIndex *
      this.audioCtx.sampleRate /
      this.frequencyAnalyser
        .fftSize
    );
  }
}
