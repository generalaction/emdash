import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../renderer/assets/sounds/gilfoyle-bitcoin-alert.mp3', () => ({
  default: 'gilfoyle-bitcoin-alert.mp3',
}));

class FakeAudioParam {
  value = 0;
  events: Array<{ type: string; value: number; time: number }> = [];

  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ type: 'set', value, time });
  }

  exponentialRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ type: 'ramp', value, time });
  }
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connections: unknown[] = [];

  connect(target: unknown) {
    this.connections.push(target);
  }
}

class FakeOscillatorNode {
  type: OscillatorType = 'sine';
  frequency = new FakeAudioParam();
  connections: unknown[] = [];
  starts: number[] = [];
  stops: number[] = [];

  connect(target: unknown) {
    this.connections.push(target);
  }

  start(time: number) {
    this.starts.push(time);
  }

  stop(time: number) {
    this.stops.push(time);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  currentTime = 0;
  destination = { kind: 'destination' };
  oscillators: FakeOscillatorNode[] = [];
  gains: FakeGainNode[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    const oscillator = new FakeOscillatorNode();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }
}

class FakeAudio {
  static instances: FakeAudio[] = [];

  src: string;
  volume = 1;
  currentTime = 0;
  paused = false;
  played = false;
  private endedListeners: Array<() => void> = [];

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener(eventName: string, listener: () => void) {
    if (eventName === 'ended') {
      this.endedListeners.push(listener);
    }
  }

  pause() {
    this.paused = true;
  }

  play() {
    this.played = true;
    return Promise.resolve();
  }

  end() {
    this.endedListeners.forEach((listener) => listener());
  }
}

async function loadSoundPlayer() {
  vi.resetModules();
  FakeAudioContext.instances = [];
  FakeAudio.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext);
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
  return import('../../renderer/lib/soundPlayer');
}

describe('soundPlayer', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the classic Emdash profile by default', async () => {
    const { soundPlayer } = await loadSoundPlayer();

    soundPlayer.play('needs_attention');

    const ctx = FakeAudioContext.instances[0];
    expect(FakeAudio.instances).toHaveLength(0);
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators.map((osc) => osc.type)).toEqual(['triangle', 'triangle']);
  });

  it('switches to the gilfoyle profile for notification alerts', async () => {
    const { soundPlayer } = await loadSoundPlayer();

    soundPlayer.setProfile('gilfoyle');
    soundPlayer.play('needs_attention');

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toBe('gilfoyle-bitcoin-alert.mp3');
    expect(FakeAudio.instances[0].played).toBe(true);
  });

  it('previews the selected profile immediately', async () => {
    const { soundPlayer } = await loadSoundPlayer();

    soundPlayer.preview('gilfoyle');

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].played).toBe(true);
  });

  it('still supports the classic Emdash profile', async () => {
    const { soundPlayer } = await loadSoundPlayer();

    soundPlayer.setProfile('default');
    soundPlayer.play('needs_attention');

    const ctx = FakeAudioContext.instances[0];
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators.map((osc) => osc.type)).toEqual(['triangle', 'triangle']);
  });
});
