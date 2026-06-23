import type { ProviderCustomConfig } from '@shared/core/app-settings';
import {
  isCodexReasoningEffort,
  isCodexServiceTier,
  isValidCodexModelId,
  isNativeChatReasoningEffort,
  isValidNativeChatModelId,
  type CodexServiceTier,
  type NativeChatReasoningEffort,
} from '@shared/native-chat';

export type AgentCommand = {
  command: string;
  args: string[];
  stdin?: string;
};

export type NativeExecProviderConfig = ProviderCustomConfig & {
  cli?: string;
  defaultArgs?: string[];
  autoApproveFlag?: string;
};

const SHELL_SYNTAX_ERROR = 'Custom CLI commands support executable command prefixes only. ';
const SHELL_BUILTINS = new Set(['.', 'source', 'eval', 'exec', 'cd', 'alias', 'export']);

function parseShellWords(
  input: string,
  options: { rejectShellSyntax?: boolean } = {}
): { ok: true; words: string[] } | { ok: false; reason: string } {
  const words: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (options.rejectShellSyntax && !inSingleQuote && !inDoubleQuote) {
      if (char === '$' || char === '`' || /[|&;<>]/.test(char)) {
        return { ok: false, reason: SHELL_SYNTAX_ERROR };
      }
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        words.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaped) current += '\\';
  if (inSingleQuote || inDoubleQuote) return { ok: false, reason: 'Unclosed quote.' };
  if (current.length > 0) words.push(current);

  return { ok: true, words };
}

function parseArgField(value: string | undefined): string[] {
  if (!value) return [];
  const parsed = parseShellWords(value);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.words;
}

function parseCliPrefix(value: string | undefined, providerId: string): string[] {
  const cli = value?.trim();
  if (!cli) throw new Error(`Missing CLI command for provider: ${providerId}`);

  const parsed = parseShellWords(cli, { rejectShellSyntax: true });
  if (!parsed.ok) throw new Error(parsed.reason);
  const [command] = parsed.words;
  if (!command) throw new Error(`Missing CLI command for provider: ${providerId}`);
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(command)) throw new Error(SHELL_SYNTAX_ERROR);
  if (SHELL_BUILTINS.has(command)) throw new Error(SHELL_SYNTAX_ERROR);

  return parsed.words;
}

/** Codex thread/session ids are UUIDs; reject anything else before passing it to `resume`. */
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCodexThreadId(value: string): boolean {
  return CODEX_THREAD_ID_PATTERN.test(value);
}

/** Claude Code session ids are UUIDs; reject anything else before `--resume`. */
const CLAUDE_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isClaudeSessionId(value: string): boolean {
  return CLAUDE_SESSION_ID_PATTERN.test(value);
}

const PI_THINKING_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;

export function isPiThinkingLevel(value: unknown): value is (typeof PI_THINKING_LEVELS)[number] {
  return typeof value === 'string' && (PI_THINKING_LEVELS as readonly string[]).includes(value);
}

/**
 * Build the argv for one native chat turn: `codex exec --json -` (or
 * `codex exec resume <thread-id> --json -` for follow-ups). The prompt is
 * piped on stdin so Codex never re-parses user text as CLI flags.
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
  providerConfig: NativeExecProviderConfig | undefined;
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

  args.push(...(providerConfig?.defaultArgs ?? []));
  args.push(...parseArgField(providerConfig?.extraArgs));
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

  args.push('-');

  return { command, args, stdin: prompt };
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
  providerConfig: NativeExecProviderConfig | undefined;
  autoApprove?: boolean;
  resumeSessionId?: string;
  model?: string;
  reasoningEffort?: NativeChatReasoningEffort;
  prompt: string;
}): AgentCommand {
  const [command, ...args] = parseCliPrefix(providerConfig?.cli ?? 'claude', 'claude');

  args.push(...(providerConfig?.defaultArgs ?? []));
  args.push(...parseArgField(providerConfig?.extraArgs));
  args.push('-p', '--output-format', 'stream-json', '--verbose');

  if (resumeSessionId) {
    if (!isClaudeSessionId(resumeSessionId)) {
      throw new Error(`Invalid Claude session id: ${resumeSessionId}`);
    }
    args.push('--resume', resumeSessionId);
  }

  if (model) {
    // Alias ('opus') or full id ('claude-opus-4-8'); argv-safety check only.
    if (!isValidNativeChatModelId(model)) {
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
  providerConfig: NativeExecProviderConfig | undefined;
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
    if (!isValidNativeChatModelId(model)) {
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
