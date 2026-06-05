import {
  parseArgField,
  parseCliPrefix,
  type AgentCommand,
} from '@main/core/conversations/impl/agent-command';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { isValidCodexModelId, type NativeChatReasoningEffort } from '@shared/native-chat';

const PI_THINKING_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;

export function isPiThinkingLevel(value: unknown): value is (typeof PI_THINKING_LEVELS)[number] {
  return typeof value === 'string' && (PI_THINKING_LEVELS as readonly string[]).includes(value);
}

/**
 * Build the argv for one Pi native chat turn:
 * `pi --mode json --print --session-id <conversation-id> <prompt>`.
 *
 * Pi stores JSONL session history per project. Passing Emdash's conversation
 * UUID as `--session-id` gives each chat a deterministic session that can be
 * continued by subsequent one-shot JSON turns without keeping a PTY alive.
 */
export function buildPiExecCommand({
  providerConfig,
  sessionId,
  model,
  reasoningEffort,
  prompt,
}: {
  providerConfig: ProviderCustomConfig | undefined;
  sessionId: string;
  model?: string;
  reasoningEffort?: NativeChatReasoningEffort;
  prompt: string;
}): AgentCommand {
  const [command, ...args] = parseCliPrefix(providerConfig?.cli ?? 'pi', 'pi');

  args.push(...(providerConfig?.defaultArgs ?? []));
  args.push(...parseArgField(providerConfig?.extraArgs));
  args.push('--mode', 'json', '--print', '--session-id', sessionId);

  if (model) {
    if (!isValidCodexModelId(model)) {
      throw new Error(`Invalid model id: ${model}`);
    }
    args.push('--model', model);
  }

  if (reasoningEffort && isPiThinkingLevel(reasoningEffort)) {
    args.push('--thinking', reasoningEffort);
  }

  args.push(prompt);

  return { command, args };
}
