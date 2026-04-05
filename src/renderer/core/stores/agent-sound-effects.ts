import type { NotificationSettings } from '@shared/app-settings';
import {
  agentEventChannel,
  isAttentionNotification,
  type AgentEvent,
  type SoundEvent,
} from '@shared/events/agentEvents';
import { soundPlayer } from '../../lib/soundPlayer';
import { events, rpc } from '../ipc';

function mapToSound(event: AgentEvent): SoundEvent | null {
  if (event.type === 'stop') return 'task_complete';
  if (event.type === 'notification' && isAttentionNotification(event.payload.notificationType)) {
    return 'needs_attention';
  }
  return null;
}

async function applySoundSettings(): Promise<void> {
  try {
    const meta = (await rpc.appSettings.getWithMeta('notifications')) as {
      value: NotificationSettings;
    };
    soundPlayer.setEnabled(meta.value.sound ?? true);
    soundPlayer.setFocusMode(meta.value.soundFocusMode ?? 'always');
  } catch {}
}

export function initAgentSoundEffects(): () => void {
  void applySoundSettings();
  return events.on(agentEventChannel, ({ event, appFocused }) => {
    const sound = mapToSound(event);
    if (sound) soundPlayer.play(sound, appFocused);
  });
}
