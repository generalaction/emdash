import type { NotificationSettings } from '@shared/app-settings';
import type { SoundEvent } from '@shared/events/agentEvents';
import { rpc } from '../core/ipc';

let audioCtx: AudioContext | null = null;
let enabled = true;
let focusMode: 'always' | 'unfocused' = 'always';

export function initSoundPlayer(): void {
  rpc.appSettings
    .getWithMeta('notifications')
    .then((meta) => {
      const value = (meta as { value: NotificationSettings }).value;
      enabled = value.sound ?? true;
      focusMode = value.soundFocusMode ?? 'always';
    })
    .catch(() => {});
}

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function playTone(
  frequency: number,
  startTime: number,
  duration: number,
  type: OscillatorType = 'triangle',
  gain = 0.15
): void {
  const ctx = getContext();
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  vol.gain.setValueAtTime(gain, startTime);
  vol.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(vol);
  vol.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playNeedsAttention(): void {
  const ctx = getContext();
  const now = ctx.currentTime;
  // Two ascending triangle-wave pips
  playTone(880, now, 0.12);
  playTone(1100, now + 0.15, 0.12);
}

function playTaskComplete(): void {
  const ctx = getContext();
  const now = ctx.currentTime;
  // Three-note ascending chime: C5 → E5 → G5
  playTone(523.25, now, 0.15, 'triangle', 0.12);
  playTone(659.25, now + 0.18, 0.15, 'triangle', 0.12);
  playTone(783.99, now + 0.36, 0.2, 'triangle', 0.12);
}

export const soundPlayer = {
  play(event: SoundEvent, appFocused?: boolean): void {
    if (!enabled) return;
    if (focusMode === 'unfocused' && appFocused) return;
    try {
      switch (event) {
        case 'needs_attention':
          playNeedsAttention();
          break;
        case 'task_complete':
          playTaskComplete();
          break;
      }
    } catch {
      // Audio may fail if user hasn't interacted with page yet
    }
  },
};
