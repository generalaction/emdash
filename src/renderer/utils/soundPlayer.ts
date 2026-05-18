import type { NotificationSettings } from '@shared/app-settings';
import type { SoundEvent } from '@shared/events/agentEvents';
import { rpc } from '../lib/ipc';

let audioCtx: AudioContext | null = null;
let enabled = true;
let focusMode: 'always' | 'unfocused' = 'always';
let customSoundPath = '';
const customAudioCache = new Map<string, string>();
let activePreviewAudio: HTMLAudioElement | null = null;
let activePreviewTones: Array<() => void> = [];
let previewGeneration = 0;

export function initSoundPlayer(): void {
  rpc.appSettings
    .getWithMeta('notifications')
    .then((meta) => {
      const value = (meta as { value: NotificationSettings }).value;
      configureSoundPlayer(value);
    })
    .catch(() => {});
}

export function configureSoundPlayer(settings: NotificationSettings): void {
  enabled = settings.sound ?? true;
  focusMode = settings.soundFocusMode ?? 'always';
  const nextCustomSoundPath = settings.customSoundPath?.trim() ?? '';
  if (nextCustomSoundPath !== customSoundPath) {
    customAudioCache.clear();
  }
  customSoundPath = nextCustomSoundPath;
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
): () => void {
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
  return () => {
    try {
      osc.stop();
    } catch {
      // Already stopped.
    }
    osc.disconnect();
    vol.disconnect();
  };
}

function playNeedsAttention(): Array<() => void> {
  const ctx = getContext();
  const now = ctx.currentTime;
  // Two ascending triangle-wave pips
  return [playTone(880, now, 0.12), playTone(1100, now + 0.15, 0.12)];
}

function playTaskComplete(): Array<() => void> {
  const ctx = getContext();
  const now = ctx.currentTime;
  // Three-note ascending chime: C5 → E5 → G5
  return [
    playTone(523.25, now, 0.15, 'triangle', 0.12),
    playTone(659.25, now + 0.18, 0.15, 'triangle', 0.12),
    playTone(783.99, now + 0.36, 0.2, 'triangle', 0.12),
  ];
}

async function getCustomSoundDataUrl(path: string): Promise<string | null> {
  let dataUrl = customAudioCache.get(path);
  if (!dataUrl) {
    const result = (await rpc.app.readAudioFileDataUrl(path)) as
      | { success: true; dataUrl: string }
      | { success: false; error: string };
    if (!result.success) return null;
    dataUrl = result.dataUrl;
    customAudioCache.set(path, dataUrl);
  }
  return dataUrl;
}

async function playCustomSound(path: string): Promise<boolean> {
  try {
    const dataUrl = await getCustomSoundDataUrl(path);
    if (!dataUrl) return false;
    const audio = new Audio(dataUrl);
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

function playBuiltinSound(event: SoundEvent): Array<() => void> {
  switch (event) {
    case 'needs_attention':
      return playNeedsAttention();
    case 'task_complete':
      return playTaskComplete();
  }
}

function stopActivePreview(): void {
  if (activePreviewAudio) {
    activePreviewAudio.pause();
    activePreviewAudio.currentTime = 0;
    activePreviewAudio = null;
  }
  for (const stopTone of activePreviewTones) {
    stopTone();
  }
  activePreviewTones = [];
}

export const soundPlayer = {
  play(event: SoundEvent, appFocused?: boolean): void {
    if (!enabled) return;
    if (focusMode === 'unfocused' && appFocused) return;
    try {
      if (customSoundPath) {
        void playCustomSound(customSoundPath).then((played) => {
          if (!played) playBuiltinSound(event);
        });
        return;
      }
      playBuiltinSound(event);
    } catch {
      // Audio may fail if user hasn't interacted with page yet
    }
  },
  preview(path?: string): void {
    stopActivePreview();
    const generation = ++previewGeneration;
    const previewPath = path?.trim();
    if (previewPath) {
      void getCustomSoundDataUrl(previewPath)
        .then((dataUrl) => {
          if (generation !== previewGeneration) return;
          if (!dataUrl) {
            activePreviewTones = playBuiltinSound('needs_attention');
            return;
          }
          const audio = new Audio(dataUrl);
          activePreviewAudio = audio;
          audio.addEventListener(
            'ended',
            () => {
              if (activePreviewAudio === audio) activePreviewAudio = null;
            },
            { once: true }
          );
          void audio.play();
        })
        .catch(() => {
          if (generation === previewGeneration) {
            activePreviewTones = playBuiltinSound('needs_attention');
          }
        });
      return;
    }
    activePreviewTones = playBuiltinSound('needs_attention');
  },
};
