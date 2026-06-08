// src/lib/audio/AudioEngine.ts
// SS_SCOPE v4 Audio Engine

export class AudioEngine {

  audioCtx: AudioContext;

  analyser: AnalyserNode;
  frequencyAnalyser: AnalyserNode;
  leftAnalyser: AnalyserNode;
  rightAnalyser: AnalyserNode;

  inputGain: GainNode;
  outputGain: GainNode;
  monitorGain: GainNode;

  filterNode: BiquadFilterNode;
  highpassNode: BiquadFilterNode;

  distortionNode: WaveShaperNode;

  delayNode: DelayNode;
  delayGain: GainNode;

  keepAliveGain: GainNode;
  stereoSplitter: ChannelSplitterNode;

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

    this.leftAnalyser =
      this.audioCtx
        .createAnalyser();

    this.leftAnalyser.fftSize =
      2048;

    this.leftAnalyser.smoothingTimeConstant =
      0;

    this.rightAnalyser =
      this.audioCtx
        .createAnalyser();

    this.rightAnalyser.fftSize =
      2048;

    this.rightAnalyser.smoothingTimeConstant =
      0;

    /*
    --------------------------------
    DSP NODES
    --------------------------------
    */

    this.inputGain =
      this.audioCtx
        .createGain();

    this.inputGain.gain.value =
      1;

    this.outputGain =
      this.audioCtx
        .createGain();

    this.outputGain.gain.value =
      1;

    this.monitorGain =
      this.audioCtx
        .createGain();

    // monitor muted by default

    this.monitorGain.gain.value =
      0;

    this.keepAliveGain =
      this.audioCtx
        .createGain();

    // prevents browser graph suspension

    this.keepAliveGain.gain.value =
      0.00001;

    this.stereoSplitter =
      this.audioCtx
        .createChannelSplitter(2);

    this.filterNode =
      this.audioCtx
        .createBiquadFilter();

    this.filterNode.type =
      'lowpass';

    this.filterNode.frequency.value =
      20000;

    this.filterNode.Q.value =
      0.0001;

    this.highpassNode =
      this.audioCtx
        .createBiquadFilter();

    this.highpassNode.type =
      'highpass';

    this.highpassNode.frequency.value =
      10;

    this.highpassNode.Q.value =
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
      -> DRY + DELAY
      -> OUTPUT BUS
      -> ANALYSIS
      -> MONITOR
      -> OUTPUT

    --------------------------------
    */

    // input chain

    this.inputGain.connect(
      this.distortionNode
    );

    this.distortionNode.connect(
      this.filterNode
    );

    // delay send

    this.filterNode.connect(
      this.highpassNode
    );

    this.highpassNode.connect(
      this.delayNode
    );

    this.delayNode.connect(
      this.delayGain
    );

    // dry path

    this.highpassNode.connect(
      this.outputGain
    );

    // wet path

    this.delayGain.connect(
      this.outputGain
    );

    /*
    --------------------------------
    ANALYSIS TAP
    --------------------------------
    */

    this.outputGain.connect(
      this.analyser
    );

    this.outputGain.connect(
      this.frequencyAnalyser
    );

    this.outputGain.connect(
      this.stereoSplitter
    );

    this.stereoSplitter.connect(
      this.leftAnalyser,
      0
    );

    this.stereoSplitter.connect(
      this.rightAnalyser,
      1
    );

    /*
    --------------------------------
    MONITOR PATH
    --------------------------------
    */

    this.outputGain.connect(
      this.monitorGain
    );

    this.monitorGain.connect(
      this.audioCtx.destination
    );

    /*
    --------------------------------
    KEEPALIVE PATH
    --------------------------------
    */

    this.outputGain.connect(
      this.keepAliveGain
    );

    this.keepAliveGain.connect(
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

    this.stopInput();

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

  setHPF(
    frequency: number
  ) {

    this.highpassNode.frequency.value =
      frequency;
  }

  setFftSize(
    timeFftSize: number,
    frequencyFftSize = timeFftSize * 2
  ) {

    this.analyser.fftSize =
      timeFftSize;

    this.frequencyAnalyser.fftSize =
      frequencyFftSize;

    this.leftAnalyser.fftSize =
      timeFftSize;

    this.rightAnalyser.fftSize =
      timeFftSize;
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

  fillTimeData(
    target: Uint8Array<ArrayBufferLike>
  ) {

    this.analyser
      .getByteTimeDomainData(
        target as unknown as Uint8Array<ArrayBuffer>
      );
  }

  fillLissajousData(
    xTarget: Uint8Array<ArrayBufferLike>,
    yTarget: Uint8Array<ArrayBufferLike>
  ) {

    this.leftAnalyser
      .getByteTimeDomainData(
        xTarget as unknown as Uint8Array<ArrayBuffer>
      );

    this.rightAnalyser
      .getByteTimeDomainData(
        yTarget as unknown as Uint8Array<ArrayBuffer>
      );

    let rightHasSignal =
      false;

    for (
      let i = 0;
      i < yTarget.length;
      i++
    ) {

      if (Math.abs(yTarget[i] - 128) > 1) {
        rightHasSignal =
          true;
        break;
      }
    }

    if (!rightHasSignal) {
      yTarget.set(
        xTarget.subarray(
          0,
          yTarget.length
        )
      );
    }
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

  fillFrequencyData(
    target: Uint8Array<ArrayBufferLike>
  ) {

    this.frequencyAnalyser
      .getByteFrequencyData(
        target as unknown as Uint8Array<ArrayBuffer>
      );
  }

  /*
  --------------------------------
  RMS
  --------------------------------
  */

  getRMS() {

    const data =
      new Uint8Array(
        this.analyser
          .fftSize
      );

    this.fillTimeData(
      data
    );

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

    let peakIndex = 0;
    let peakValue = 0;

    for (
      let i = 0;
      i < freq.length;
      i++
    ) {

      if (
        freq[i] >
        peakValue
      ) {

        peakValue =
          freq[i];

        peakIndex =
          i;
      }
    }

    return (
      peakIndex *
      this.audioCtx.sampleRate /
      this.frequencyAnalyser
        .fftSize
    );
  }

  stopInput() {

    if (this.sourceNode) {

      this.sourceNode.disconnect();

      this.sourceNode =
        undefined;
    }

    if (this.stream) {

      this.stream
        .getTracks()
        .forEach(track => {
          track.stop();
        });

      this.stream =
        undefined;
    }
  }

  async close() {

    this.stopInput();

    await this.audioCtx.close();
  }
}
