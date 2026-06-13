import type { AgentProviderId } from './agent-provider-registry';

/** A selectable model for a provider. */
export type AgentModelOption = { id: string; label: string };

/** A selectable reasoning-effort level for a provider. */
export type AgentReasoningOption = { id: string; label: string };

/**
 * Per-provider model + reasoning metadata. Drives the Models settings UI and
 * translates a stored selection into the CLI arguments understood by each agent.
 *
 * Only providers with a predictable, documented set of models/flags are listed
 * here (currently Codex, Claude Code, and Cursor). Other providers fall back to
 * their CLI/config defaults.
 */
export type AgentModelSupport = {
  /** Selectable models. Users may also choose "Default" (no `--model` flag). */
  models: AgentModelOption[];
  /** Reasoning-effort levels when the provider exposes a dedicated flag. */
  reasoning?: AgentReasoningOption[];
  /** argv tokens for an explicit model selection. */
  toModelArgs: (modelId: string) => string[];
  /** argv tokens for an explicit reasoning-effort selection. */
  toReasoningArgs?: (effortId: string) => string[];
};

/** A user's model + reasoning choice for a single provider. */
export type AgentModelSelection = {
  model?: string;
  reasoningEffort?: string;
};

/**
 * Curated model + reasoning support for the providers with predictable model
 * availability. Lists reflect the CLI versions tested (codex 0.139, claude 2.1,
 * cursor-agent 2026.06) and are safe to extend over time.
 */
export const AGENT_MODEL_SUPPORT = {
  codex: {
    // Codex takes the model id via `--model` and the reasoning effort separately
    // via `-c model_reasoning_effort=<level>`.
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
      { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
      { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
    ],
    reasoning: [
      { id: 'minimal', label: 'Minimal' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'Extra high' },
    ],
    toModelArgs: (modelId: string): string[] => ['--model', modelId],
    toReasoningArgs: (effortId: string): string[] => ['-c', `model_reasoning_effort=${effortId}`],
  },
  claude: {
    // Claude Code takes a model alias (or full name) via `--model` and a separate
    // reasoning effort via `--effort`.
    models: [
      { id: 'opus', label: 'Opus' },
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'haiku', label: 'Haiku' },
    ],
    reasoning: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'Extra high' },
      { id: 'max', label: 'Max' },
    ],
    toModelArgs: (modelId: string): string[] => ['--model', modelId],
    toReasoningArgs: (effortId: string): string[] => ['--effort', effortId],
  },
  cursor: {
    // Cursor bakes the reasoning level into the model id (e.g. `-thinking`,
    // `-high`), so there is no separate reasoning flag.
    models: [
      { id: 'auto', label: 'Auto' },
      { id: 'composer-2.5', label: 'Composer 2.5' },
      { id: 'claude-4.5-sonnet', label: 'Sonnet 4.5' },
      { id: 'claude-4.5-sonnet-thinking', label: 'Sonnet 4.5 Thinking' },
      { id: 'gpt-5.1', label: 'GPT-5.1' },
      { id: 'gpt-5.1-high', label: 'GPT-5.1 High' },
    ],
    toModelArgs: (modelId: string): string[] => ['--model', modelId],
  },
  amp: {
    // Amp selects the model through its agent "mode" (`--mode`), which controls
    // the model, system prompt, and tool selection. Amp also exposes `--effort`,
    // but its valid values are mode-dependent and undocumented, so it is omitted.
    models: [
      { id: 'smart', label: 'Smart' },
      { id: 'rush', label: 'Rush' },
      { id: 'deep', label: 'Deep' },
    ],
    toModelArgs: (modelId: string): string[] => ['--mode', modelId],
  },
} satisfies Partial<Record<AgentProviderId, AgentModelSupport>>;

export type ModelSelectableProviderId = keyof typeof AGENT_MODEL_SUPPORT;

/** Providers that expose a curated model/reasoning selection. */
export const MODEL_SELECTABLE_PROVIDER_IDS = Object.keys(
  AGENT_MODEL_SUPPORT
) as ModelSelectableProviderId[];

export function getAgentModelSupport(providerId: AgentProviderId): AgentModelSupport | undefined {
  return (AGENT_MODEL_SUPPORT as Partial<Record<AgentProviderId, AgentModelSupport>>)[providerId];
}

export function providerSupportsModelSelection(providerId: AgentProviderId): boolean {
  return getAgentModelSupport(providerId) !== undefined;
}

/**
 * Translate a stored model selection into CLI arguments for the given provider.
 *
 * Returns an empty array when the provider has no curated model support or when
 * the selection is empty. Stored values are checked against the current curated
 * option ids before being passed as discrete argv tokens (never through a shell),
 * so stale settings are ignored instead of breaking new sessions.
 */
export function buildAgentModelArgs(
  providerId: AgentProviderId,
  selection: AgentModelSelection | undefined
): string[] {
  const support = getAgentModelSupport(providerId);
  if (!support || !selection) return [];

  const args: string[] = [];

  const model = selection.model?.trim();
  if (model && support.models.some((option) => option.id === model)) {
    args.push(...support.toModelArgs(model));
  }

  const effort = selection.reasoningEffort?.trim();
  if (
    effort &&
    support.reasoning?.some((option) => option.id === effort) &&
    support.toReasoningArgs
  ) {
    args.push(...support.toReasoningArgs(effort));
  }

  return args;
}
