import {
  parseArgField,
  parseCliPrefix,
  type AgentCommand,
} from '@main/core/conversations/impl/agent-command';
import type { ProviderCustomConfig } from '@shared/app-settings';
import {
  isNativeChatReasoningEffort,
  isValidCodexModelId,
  type NativeChatReasoningEffort,
} from '@shared/native-chat';

/** Claude Code session ids are UUIDs; reject anything else before `--resume`. */
const CLAUDE_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isClaudeSessionId(value: string): boolean {
  return CLAUDE_SESSION_ID_PATTERN.test(value);
}

/**
 * Build the argv for one native chat turn against Claude Code:
 * `claude -p --output-format stream-json --verbose` (plus `--resume <id>` for
 * follow-ups). Spawned directly from the argv array, no shell.
 */
export function buildClaudeExecCommand({
  providerConfig,
  autoApprove,
  resumeSessionId,
  model,
  reasoningEffort,
  prompt,
}: {
  providerConfig: ProviderCustomConfig | undefined;
  autoApprove?: boolean;
  resumeSessionId?: string;
  model?: string;
  reasoningEffort?: NativeChatReasoningEffort;
  prompt: string;
}): AgentCommand {
  const [command, ...args] = parseCliPrefix(providerConfig?.cli ?? 'claude', 'claude');

  args.push('-p', '--output-format', 'stream-json', '--verbose');

  if (resumeSessionId) {
    if (!isClaudeSessionId(resumeSessionId)) {
      throw new Error(`Invalid Claude session id: ${resumeSessionId}`);
    }
    args.push('--resume', resumeSessionId);
  }

  if (model) {
    // Alias ('opus') or full id ('claude-opus-4-8'); argv-safety check only.
    if (!isValidCodexModelId(model)) {
      throw new Error(`Invalid model id: ${model}`);
    }
    args.push('--model', model);
  }

  if (reasoningEffort && isNativeChatReasoningEffort(reasoningEffort)) {
    args.push('--effort', reasoningEffort);
  }

  if (autoApprove && providerConfig?.autoApproveFlag) {
    // Same flag the TUI path uses (--dangerously-skip-permissions).
    args.push(...parseArgField(providerConfig.autoApproveFlag));
  } else {
    // Print mode cannot answer permission prompts; let file edits proceed and
    // surface denied tools as failed tool results instead of hanging.
    args.push('--permission-mode', 'acceptEdits');
  }

  args.push(prompt);

  return { command, args };
}
