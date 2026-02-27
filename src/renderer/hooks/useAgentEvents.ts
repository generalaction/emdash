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
    console.log('[useAgentEvents] subscribing to agent:event IPC');
    const cleanup = window.electronAPI.onAgentEvent((event: AgentEvent) => {
      const sound = mapToSound(event);
      console.log('[useAgentEvents] received event', {
        type: event.type,
        ptyId: event.ptyId,
        notificationType: event.payload.notificationType,
        mappedSound: sound,
      });

      // Play sound for all tasks regardless of focus
      if (sound) {
        soundPlayer.play(sound);
      }

      // Forward to caller for additional handling (e.g. activityStore)
      onEvent?.(event);
    });

    return cleanup;
  }, [onEvent]);
}
