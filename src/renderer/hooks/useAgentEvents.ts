import { useEffect } from 'react';
import type { AgentEvent, SoundEvent } from '@shared/events/agentEvents';
import { agentEventChannel } from '@shared/events/agentEvents';
import { soundPlayer } from '../lib/soundPlayer';
import { events } from '../lib/rpc';

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
    return events.on(agentEventChannel, ({ event, appFocused }) => {
      const sound = mapToSound(event);
      if (sound) {
        soundPlayer.play(sound, appFocused);
      }
      onEvent?.(event);
    });
  }, [onEvent]);
}
