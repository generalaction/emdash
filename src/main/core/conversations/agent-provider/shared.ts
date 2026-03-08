import { agentEventChannel } from '@shared/events/agentEvents';
import { Pty } from '@main/core/pty/pty';
import { events } from '@main/lib/events';
import { createClassifier } from './agent-event-classifiers';
import type { AgentSessionConfig } from './agent-session';

export function wireAgentClassifier(pty: Pty, sessionId: string, cfg: AgentSessionConfig): void {
  const classifier = createClassifier(cfg.providerId);

  pty.onData((chunk) => {
    const result = classifier.classify(chunk);
    if (result) {
      events.emit(
        agentEventChannel,
        {
          event: {
            type: result.type,
            ptyId: sessionId,
            conversationId: cfg.conversationId,
            taskId: cfg.taskId,
            providerId: cfg.providerId,
            timestamp: Date.now(),
            payload: {
              message: result.message,
              notificationType:
                result.type === 'notification' ? result.notificationType : undefined,
            },
          },
          appFocused: false,
        },
        sessionId
      );
    }
  });
}
