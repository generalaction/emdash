import { useEffect } from 'react';
import type { AgentEvent, SoundEvent } from '@shared/agentEvents';
import { soundPlayer } from '../lib/soundPlayer';

function mapToSound(event: AgentEvent): SoundEvent | null {
  if (event.type === 'stop') {
    return 'task_complete';
  }
  if (event.type === 'notification') {
    const nt = event.payload.notificationType;
    if (nt === 'permission_prompt' || nt === 'idle_prompt' || nt === 'elicitation_dialog') {
      return 'needs_attention';
    }
  }
  return null;
}

export function useAgentEvents(onEvent?: (event: AgentEvent) => void): void {
  useEffect(() => {
    const cleanup = window.electronAPI.onAgentEvent(
      (event: AgentEvent, meta: { appFocused: boolean }) => {
        const sound = mapToSound(event);
        if (sound) {
          soundPlayer.play(sound, meta.appFocused);
        }

        onEvent?.(event);
      }
    );

    return cleanup;
  }, [onEvent]);
}
