export interface LapRecord {
  index: number;
  splitMs: number;
  totalMs: number;
}

export interface TimerState {
  wallClock: string;
  elapsed: number;
  countdown: number | null;
  laps: LapRecord[];
}

type TickCallback = (state: TimerState) => void;
type ExpireCallback = () => void;

const TICK_MS = 100;

export class TimerEngine {
  private tickCallbacks = new Set<TickCallback>();
  private expireCallbacks = new Set<ExpireCallback>();
  private startAt = 0;
  private elapsedBeforeStart = 0;
  private timerId: number | null = null;
  private countdownMs: number | null = null;
  private countdownStartAt = 0;
  private countdownBaseMs = 0;
  private countdownRunning = false;
  private expired = false;
  private lapRecords: LapRecord[] = [];

  onTick(callback: TickCallback) {
    this.tickCallbacks.add(callback);
    callback(this.getState());

    return () => {
      this.tickCallbacks.delete(callback);
    };
  }

  onExpire(callback: ExpireCallback) {
    this.expireCallbacks.add(callback);

    return () => {
      this.expireCallbacks.delete(callback);
    };
  }

  start() {
    if (this.startAt === 0) {
      this.startAt = performance.now();
    }

    this.ensureTicker();
    this.emit();
  }

  stop() {
    if (this.startAt !== 0) {
      this.elapsedBeforeStart = this.getElapsed();
      this.startAt = 0;
    }

    this.countdownRunning = false;
    this.stopTickerIfIdle();
    this.emit();
  }

  reset() {
    this.startAt = 0;
    this.elapsedBeforeStart = 0;
    this.countdownMs = null;
    this.countdownStartAt = 0;
    this.countdownBaseMs = 0;
    this.countdownRunning = false;
    this.expired = false;
    this.lapRecords = [];
    this.stopTickerIfIdle();
    this.emit();
  }

  lap() {
    const totalMs = this.getElapsed();
    const previous =
      this.lapRecords.length > 0
        ? this.lapRecords[this.lapRecords.length - 1].totalMs
        : 0;

    const record: LapRecord = {
      index: this.lapRecords.length + 1,
      splitMs: totalMs - previous,
      totalMs
    };

    this.lapRecords = [
      record,
      ...this.lapRecords
    ];

    this.emit();

    return this.lapRecords;
  }

  setCountdown(seconds: number) {
    const safeSeconds =
      Math.max(
        0,
        seconds
      );

    this.countdownMs =
      safeSeconds * 1000;

    this.countdownBaseMs =
      this.countdownMs;

    this.countdownStartAt = 0;
    this.countdownRunning = false;
    this.expired = false;
    this.emit();
  }

  startCountdown() {
    if (this.countdownMs === null) {
      return;
    }

    this.countdownBaseMs =
      this.countdownMs;

    this.countdownStartAt =
      performance.now();

    this.countdownRunning =
      true;

    this.expired =
      false;

    this.ensureTicker();
    this.emit();
  }

  getState(): TimerState {
    return {
      wallClock: this.getWallClock(),
      elapsed: this.getElapsed(),
      countdown: this.getCountdown(),
      laps: [...this.lapRecords]
    };
  }

  private getElapsed() {
    if (this.startAt === 0) {
      return this.elapsedBeforeStart;
    }

    return (
      this.elapsedBeforeStart +
      performance.now() -
      this.startAt
    );
  }

  private getCountdown() {
    if (this.countdownMs === null) {
      return null;
    }

    if (!this.countdownRunning) {
      return this.countdownMs;
    }

    const remaining =
      Math.max(
        0,
        this.countdownBaseMs -
        (
          performance.now() -
          this.countdownStartAt
        )
      );

    this.countdownMs =
      remaining;

    if (
      remaining <= 0 &&
      !this.expired
    ) {
      this.expired =
        true;

      this.countdownRunning =
        false;

      this.expireCallbacks
        .forEach(callback => {
          callback();
        });
    }

    return remaining;
  }

  private getWallClock() {
    return new Date()
      .toLocaleTimeString(
        'ja-JP',
        {
          hour12: false,
          timeZone: 'Asia/Tokyo'
        }
      );
  }

  private ensureTicker() {
    if (this.timerId !== null) {
      return;
    }

    this.timerId =
      window.setTimeout(
        () => {
          this.timerId =
            null;

          this.emit();
          this.stopTickerIfIdle();

          if (
            this.startAt !== 0 ||
            this.countdownRunning
          ) {
            this.ensureTicker();
          }
        },
        TICK_MS
      );
  }

  private stopTickerIfIdle() {
    if (
      this.startAt !== 0 ||
      this.countdownRunning
    ) {
      return;
    }

    if (this.timerId !== null) {
      window.clearTimeout(
        this.timerId
      );

      this.timerId =
        null;
    }
  }

  private emit() {
    const state =
      this.getState();

    this.tickCallbacks
      .forEach(callback => {
        callback(state);
      });
  }
}
