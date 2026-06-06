/**
 * Shared types for the experimental native chat surface.
 *
 * Transcript items are produced in the main process by provider-specific
 * structured streams and consumed by the renderer chat UI.
 */

export type CodexChatItemStatus = 'in_progress' | 'completed' | 'failed';

export type CodexChatFileChange = { path: string; kind: string };

export type CodexChatTodoItem = { text: string; completed: boolean };

export type CodexChatItem =
  | { kind: 'user_message'; key: string; text: string }
  | { kind: 'agent_message'; key: string; text: string }
  | { kind: 'reasoning'; key: string; text: string }
  | {
      kind: 'command_execution';
      key: string;
      command: string;
      aggregatedOutput: string;
      exitCode: number | null;
      status: CodexChatItemStatus;
    }
  | {
      kind: 'file_change';
      key: string;
      changes: CodexChatFileChange[];
      status: CodexChatItemStatus;
    }
  | {
      kind: 'mcp_tool_call';
      key: string;
      server: string;
      tool: string;
      status: CodexChatItemStatus;
    }
  | { kind: 'web_search'; key: string; query: string }
  | { kind: 'todo_list'; key: string; items: CodexChatTodoItem[] }
  | { kind: 'error'; key: string; message: string }
  | { kind: 'system'; key: string; text: string };

export type CodexChatTurnStatus = 'idle' | 'running';

/**
 * Union of reasoning levels across native chat providers; what each provider
 * actually accepts is validated in its command builder.
 */
export const NATIVE_CHAT_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type NativeChatReasoningEffort = (typeof NATIVE_CHAT_REASONING_EFFORTS)[number];

export function isNativeChatReasoningEffort(value: unknown): value is NativeChatReasoningEffort {
  return (
    typeof value === 'string' &&
    (NATIVE_CHAT_REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

/**
 * Reasoning levels from the model catalog embedded in the Codex CLI
 * (`supported_reasoning_levels` on gpt-5.x entries), passed via
 * `-c model_reasoning_effort=...`. `xhigh` renders as "Extra High".
 */
export const CODEX_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return (
    typeof value === 'string' && (CODEX_REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

/** A selectable model or effort entry in the native chat options menu. */
export type NativeChatModelOption = { id: string; label: string; description?: string };

export type NativeChatEffortOption = {
  id: NativeChatReasoningEffort;
  label: string;
  description?: string;
};

/**
 * Claude Code models for `--model`, with the labels and descriptions its own
 * `/model` picker shows. Dateless full ids (not aliases) so the displayed
 * version always matches what actually runs.
 */
export const CLAUDE_CHAT_MODEL_OPTIONS: NativeChatModelOption[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', description: 'Most capable for complex work' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', description: 'Best for everyday tasks' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', description: 'Fastest for quick answers' },
];

/** Claude Code's `--effort` levels with the descriptions its CLI uses. */
export const CLAUDE_EFFORT_OPTIONS: NativeChatEffortOption[] = [
  {
    id: 'low',
    label: 'Low',
    description: 'Quick, straightforward implementation with minimal overhead',
  },
  {
    id: 'medium',
    label: 'Medium',
    description: 'Balanced approach with standard implementation and testing',
  },
  {
    id: 'high',
    label: 'High',
    description: 'Comprehensive implementation with extensive testing and documentation',
  },
  {
    id: 'xhigh',
    label: 'Extra high',
    description: 'Deeper reasoning than high, just below maximum',
  },
  { id: 'max', label: 'Max', description: 'Maximum reasoning depth' },
];

/** Codex model catalog entries (labels/descriptions from the embedded catalog). */
export const CODEX_CHAT_MODEL_OPTIONS: NativeChatModelOption[] = [
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    description: 'Frontier model for complex coding, research, and real-world work',
  },
  { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Strong model for everyday coding' },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    description: 'Small, fast, and cost-efficient for simpler coding tasks',
  },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', description: 'Coding-optimized model' },
  {
    id: 'gpt-5.2',
    label: 'GPT-5.2',
    description: 'Optimized for professional work and long-running agents',
  },
];

/**
 * Pi model shortcuts from its CLI examples. Pi accepts both short model aliases
 * and provider-qualified ids through `--model`.
 */
export const PI_CHAT_MODEL_OPTIONS: NativeChatModelOption[] = [
  { id: 'sonnet', label: 'Claude Sonnet', description: 'Default Claude Sonnet route' },
  { id: 'sonnet:high', label: 'Claude Sonnet High', description: 'Sonnet with high thinking' },
  { id: 'haiku', label: 'Claude Haiku', description: 'Fast Claude route' },
  { id: 'gpt-4o', label: 'GPT-4o', description: 'OpenAI model shortcut' },
  { id: 'openai/gpt-4o', label: 'OpenAI GPT-4o', description: 'Provider-qualified OpenAI route' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Fast OpenAI model shortcut' },
];

/** Codex reasoning levels with the descriptions from its embedded catalog. */
export const CODEX_EFFORT_OPTIONS: NativeChatEffortOption[] = [
  { id: 'low', label: 'Low', description: 'Fast responses with lighter reasoning' },
  {
    id: 'medium',
    label: 'Medium',
    description: 'Balances speed and reasoning depth for everyday tasks',
  },
  { id: 'high', label: 'High', description: 'Greater reasoning depth for complex problems' },
  {
    id: 'xhigh',
    label: 'Extra high',
    description: 'Extra high reasoning depth for complex problems',
  },
];

const CODEX_MODEL_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const NATIVE_CHAT_MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]+$/;

/** Argv-safety check for model ids, not a catalog check. */
export function isValidCodexModelId(value: unknown): value is string {
  return typeof value === 'string' && CODEX_MODEL_ID_PATTERN.test(value);
}

/** Argv-safety check for provider-native model ids, including Pi provider routes. */
export function isValidNativeChatModelId(value: unknown): value is string {
  return typeof value === 'string' && NATIVE_CHAT_MODEL_ID_PATTERN.test(value);
}

/**
 * Speed: Codex's `service_tier` config. The catalog exposes one non-default
 * tier, `priority` ("Fast", 1.5x speed at increased usage).
 */
export const CODEX_SERVICE_TIERS = ['priority'] as const;

export type CodexServiceTier = (typeof CODEX_SERVICE_TIERS)[number];

export function isCodexServiceTier(value: unknown): value is CodexServiceTier {
  return typeof value === 'string' && (CODEX_SERVICE_TIERS as readonly string[]).includes(value);
}

/** Per-conversation options settable from the native chat composer. */
export type CodexChatOptions = {
  /** Model id/alias; null clears back to the provider's default. */
  model?: string | null;
  /** Reasoning effort; null clears back to the model default. */
  reasoningEffort?: NativeChatReasoningEffort | null;
  /** Speed (Codex service tier); null clears back to the standard tier. */
  serviceTier?: CodexServiceTier | null;
  /** Access mode: true = full access (no sandbox/approvals), false = sandboxed. */
  autoApprove?: boolean;
};

/** A file or image attached to a native chat message. */
export type NativeChatAttachment = {
  /** Absolute path on the local machine (the task worktree's host). */
  path: string;
  kind: 'image' | 'file';
  /** Display name; defaults to the path's basename. */
  name?: string;
};

export type CodexChatState = {
  conversationId: string;
  items: CodexChatItem[];
  turnStatus: CodexChatTurnStatus;
  /** Message of the most recent failed turn; cleared when a new turn starts. */
  lastError: string | null;
  /** Wall-clock duration of finished turns, keyed by turn key (e.g. "t3"). */
  turnDurationsMs: Record<string, number>;
};

export function emptyCodexChatState(conversationId: string): CodexChatState {
  return { conversationId, items: [], turnStatus: 'idle', lastError: null, turnDurationsMs: {} };
}
