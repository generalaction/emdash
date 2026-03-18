import { AgentProviderId } from '@shared/agent-provider-registry';
import { agentEventChannel } from '@shared/events/agentEvents';
import { Pty } from '@main/core/pty/pty';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { events } from '@main/lib/events';
import { createClassifier } from './agent-event-classifiers';

export function wireAgentClassifier({
  pty,
  providerId,
  projectId,
  taskId,
  conversationId,
}: {
  pty: Pty;
  providerId: AgentProviderId;
  projectId: string;
  taskId: string;
  conversationId: string;
}): void {
  const classifier = createClassifier(providerId);
  pty.onData((chunk) => {
    const result = classifier.classify(chunk);
    if (result) {
      events.emit(agentEventChannel, {
        type: result.type,
        conversationId: conversationId,
        taskId: taskId,
        projectId: projectId,
        timestamp: Date.now(),
        payload: {
          message: result.message,
          notificationType: result.type === 'notification' ? result.notificationType : undefined,
        },
      });
    }
  });
}

export async function buildAgentCommand({
  providerId,
  autoApprove,
  initialPrompt,
  sessionId,
  isResuming,
}: {
  providerId: AgentProviderId;
  autoApprove?: boolean;
  initialPrompt?: string;
  sessionId: string;
  isResuming?: boolean;
}) {
  const providerConfig = await providerOverrideSettings.getItem(providerId);

  const cli = providerConfig?.cli;
  const args: string[] = [];

  if (isResuming && providerConfig?.sessionIdFlag) {
    args.push(providerConfig?.sessionIdFlag, sessionId);
  }

  if (autoApprove && providerConfig?.autoApproveFlag) {
    args.push(providerConfig?.autoApproveFlag);
  }

  if (!isResuming && initialPrompt && providerConfig?.initialPromptFlag) {
    args.push(providerConfig?.initialPromptFlag, initialPrompt);
    args.push(initialPrompt);
  }

  args.push(...(providerConfig?.defaultArgs ?? []));

  return { command: cli!, args };
}
