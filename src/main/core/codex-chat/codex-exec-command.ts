import {
  parseArgField,
  parseCliPrefix,
  type AgentCommand,
} from '@main/core/conversations/impl/agent-command';
import type { ProviderCustomConfig } from '@shared/app-settings';
import {
  isCodexReasoningEffort,
  isCodexServiceTier,
  isValidCodexModelId,
  type CodexServiceTier,
  type NativeChatReasoningEffort,
} from '@shared/native-chat';

/** Codex thread/session ids are UUIDs; reject anything else before passing it to `resume`. */
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCodexThreadId(value: string): boolean {
  return CODEX_THREAD_ID_PATTERN.test(value);
}

/**
 * Build the argv for one native chat turn: `codex exec --json` (or
 * `codex exec resume <thread-id> --json` for follow-ups). The command is
 * spawned directly (argv array, no shell), so no shell quoting is involved.
 */
export function buildCodexExecCommand({
  providerConfig,
  autoApprove,
  resumeThreadId,
  model,
  reasoningEffort,
  serviceTier,
  images,
  prompt,
}: {
  providerConfig: ProviderCustomConfig | undefined;
  autoApprove?: boolean;
  resumeThreadId?: string;
  model?: string;
  /** Wide union; values outside the Codex set are dropped, not passed through. */
  reasoningEffort?: NativeChatReasoningEffort;
  serviceTier?: CodexServiceTier;
  /** Image file paths attached via `-i`. */
  images?: string[];
  prompt: string;
}): AgentCommand {
  const [command, ...args] = parseCliPrefix(providerConfig?.cli ?? 'codex', 'codex');

  args.push('exec');
  if (resumeThreadId) {
    if (!isCodexThreadId(resumeThreadId)) {
      throw new Error(`Invalid Codex thread id: ${resumeThreadId}`);
    }
    args.push('resume', resumeThreadId);
  }
  args.push('--json');

  if (autoApprove && providerConfig?.autoApproveFlag) {
    // Same overrides the TUI path uses for auto-approve (approval_policy=never,
    // sandbox_mode=danger-full-access, --dangerously-bypass-hook-trust).
    args.push(...parseArgField(providerConfig.autoApproveFlag));
  } else {
    // `codex exec` is non-interactive, so approvals can never be granted.
    // Constrain writes to the workspace; commands needing escalation fail
    // instead of prompting. Uses `-c` (not `-s`) because `exec resume` only
    // accepts config overrides.
    args.push('-c', 'sandbox_mode=workspace-write');
    // Emdash writes its own Codex hook config into the worktree; a
    // non-interactive run cannot answer the hook trust prompt, so bypass it
    // exactly as the auto-approve TUI flag does.
    args.push('--dangerously-bypass-hook-trust');
  }

  if (model) {
    if (!isValidCodexModelId(model)) {
      throw new Error(`Invalid model id: ${model}`);
    }
    args.push('-m', model);
  }

  if (reasoningEffort && isCodexReasoningEffort(reasoningEffort)) {
    args.push('-c', `model_reasoning_effort=${reasoningEffort}`);
  }

  if (serviceTier && isCodexServiceTier(serviceTier)) {
    args.push('-c', `service_tier=${serviceTier}`);
  }

  for (const image of images ?? []) {
    if (!image || image.includes('\0')) {
      throw new Error('Invalid image path');
    }
    args.push('-i', image);
  }

  args.push(prompt);

  return { command, args };
}
