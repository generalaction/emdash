import { AgentProviderId } from '@shared/agent-provider-registry';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';

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

  if (isResuming && providerConfig?.resumeFlag) {
    args.push(...providerConfig.resumeFlag.split(' '));
  }

  if (providerConfig?.sessionIdFlag) {
    args.push(providerConfig.sessionIdFlag, sessionId);
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
