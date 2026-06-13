import type { AgentProviderId } from './agent-provider-registry';

/** A selectable reasoning-effort level for a provider/model. */
export type AgentReasoningOption = { id: string; label: string };

/** A selectable model for a provider. */
export type AgentModelOption = {
  id: string;
  label: string;
  /**
   * Reasoning levels available for this specific model. When present (even
   * empty), it overrides the provider-level {@link AgentModelSupport.reasoning}.
   * An empty array means the model exposes no reasoning selector. When omitted,
   * the provider-level reasoning applies.
   */
  reasoning?: AgentReasoningOption[];
};

/**
 * Per-provider model + reasoning metadata. Drives the Models settings UI and
 * translates a stored selection into the CLI arguments understood by each agent.
 *
 * Only providers with a predictable, documented set of models/flags are listed
 * here (currently Codex, Claude Code, Cursor, and Amp). Other providers fall
 * back to their CLI/config defaults.
 */
export type AgentModelSupport = {
  /** Selectable models. Users may also choose "Default" (no model flag). */
  models: AgentModelOption[];
  /**
   * Reasoning levels shared by all models that do not define their own list
   * (e.g. Codex and Claude expose a single effort flag independent of model).
   */
  reasoning?: AgentReasoningOption[];
  /**
   * Build argv tokens for an already-validated `(model, effort)` selection.
   * Both values are guaranteed to be valid option ids (or `undefined`).
   */
  buildArgs: (model: string | undefined, effort: string | undefined) => string[];
};

/** A user's model + reasoning choice for a single provider. */
export type AgentModelSelection = {
  model?: string;
  reasoningEffort?: string;
};

const CODEX_REASONING: AgentReasoningOption[] = [
  { id: 'minimal', label: 'Minimal' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra High' },
];

const CLAUDE_REASONING: AgentReasoningOption[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra High' },
  { id: 'max', label: 'Max' },
];

// Amp exposes `--effort` for the `smart` and `deep` modes; `rush` has no
// reasoning. Valid values come from Amp's SDK docs.
const AMP_REASONING: AgentReasoningOption[] = [
  { id: 'none', label: 'None' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra High' },
  { id: 'max', label: 'Max' },
];

/**
 * Cursor bakes the reasoning level into the model id, and the suffixes differ
 * per family (e.g. `gpt-5.5-extra-high` vs `gpt-5.4-xhigh`, plain `gpt-5.2` ==
 * medium). Each base model therefore maps an effort id to a concrete, verified
 * `--model` value (from `cursor-agent --list-models`).
 */
type CursorReasoningVariant = AgentReasoningOption & { modelId: string };
type CursorModelDef = {
  id: string;
  label: string;
  /** `--model` value used when no reasoning level is chosen. */
  defaultModelId: string;
  variants?: CursorReasoningVariant[];
};

const CURSOR_MODELS: CursorModelDef[] = [
  { id: 'auto', label: 'Auto', defaultModelId: 'auto' },
  { id: 'composer-2.5', label: 'Composer 2.5', defaultModelId: 'composer-2.5' },
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    defaultModelId: 'gpt-5.5-medium',
    variants: [
      { id: 'low', label: 'Low', modelId: 'gpt-5.5-low' },
      { id: 'medium', label: 'Medium', modelId: 'gpt-5.5-medium' },
      { id: 'high', label: 'High', modelId: 'gpt-5.5-high' },
      { id: 'xhigh', label: 'Extra High', modelId: 'gpt-5.5-extra-high' },
    ],
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    defaultModelId: 'gpt-5.4-medium',
    variants: [
      { id: 'low', label: 'Low', modelId: 'gpt-5.4-low' },
      { id: 'medium', label: 'Medium', modelId: 'gpt-5.4-medium' },
      { id: 'high', label: 'High', modelId: 'gpt-5.4-high' },
      { id: 'xhigh', label: 'Extra High', modelId: 'gpt-5.4-xhigh' },
    ],
  },
  {
    id: 'gpt-5.2',
    label: 'GPT-5.2',
    defaultModelId: 'gpt-5.2',
    variants: [
      { id: 'low', label: 'Low', modelId: 'gpt-5.2-low' },
      { id: 'medium', label: 'Medium', modelId: 'gpt-5.2' },
      { id: 'high', label: 'High', modelId: 'gpt-5.2-high' },
      { id: 'xhigh', label: 'Extra High', modelId: 'gpt-5.2-xhigh' },
    ],
  },
  {
    id: 'gpt-5.1',
    label: 'GPT-5.1',
    defaultModelId: 'gpt-5.1',
    variants: [
      { id: 'low', label: 'Low', modelId: 'gpt-5.1-low' },
      { id: 'medium', label: 'Medium', modelId: 'gpt-5.1' },
      { id: 'high', label: 'High', modelId: 'gpt-5.1-high' },
    ],
  },
  {
    id: 'claude-4.5-sonnet',
    label: 'Sonnet 4.5',
    defaultModelId: 'claude-4.5-sonnet',
    variants: [
      { id: 'standard', label: 'Standard', modelId: 'claude-4.5-sonnet' },
      { id: 'thinking', label: 'Thinking', modelId: 'claude-4.5-sonnet-thinking' },
    ],
  },
  {
    id: 'claude-opus-4-8',
    label: 'Opus 4.8',
    defaultModelId: 'claude-opus-4-8-high',
    variants: [
      { id: 'low', label: 'Low', modelId: 'claude-opus-4-8-low' },
      { id: 'medium', label: 'Medium', modelId: 'claude-opus-4-8-medium' },
      { id: 'high', label: 'High', modelId: 'claude-opus-4-8-high' },
      { id: 'xhigh', label: 'Extra High', modelId: 'claude-opus-4-8-xhigh' },
      { id: 'max', label: 'Max', modelId: 'claude-opus-4-8-max' },
      { id: 'thinking', label: 'Thinking', modelId: 'claude-opus-4-8-thinking-high' },
    ],
  },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', defaultModelId: 'gemini-3.1-pro' },
  { id: 'grok-4.3', label: 'Grok 4.3', defaultModelId: 'grok-4.3' },
  { id: 'kimi-k2.5', label: 'Kimi K2.5', defaultModelId: 'kimi-k2.5' },
];

function cursorModelOptions(): AgentModelOption[] {
  return CURSOR_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    reasoning: model.variants?.map((variant) => ({ id: variant.id, label: variant.label })) ?? [],
  }));
}

function buildCursorArgs(model: string | undefined, effort: string | undefined): string[] {
  if (!model) return [];
  const def = CURSOR_MODELS.find((entry) => entry.id === model);
  if (!def) return [];
  const variant = effort ? def.variants?.find((entry) => entry.id === effort) : undefined;
  return ['--model', variant?.modelId ?? def.defaultModelId];
}

/**
 * Curated model + reasoning support for the providers with predictable model
 * availability. Lists reflect the CLI versions tested (codex 0.139, claude 2.1,
 * cursor-agent 2026.06, amp 0.x) and are safe to extend over time.
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
    reasoning: CODEX_REASONING,
    buildArgs: (model, effort): string[] => {
      const args: string[] = [];
      if (model) args.push('--model', model);
      if (effort) args.push('-c', `model_reasoning_effort=${effort}`);
      return args;
    },
  },
  claude: {
    // Claude Code takes a model alias (or full name) via `--model` and a separate
    // reasoning effort via `--effort`.
    models: [
      { id: 'opus', label: 'Opus' },
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'haiku', label: 'Haiku' },
    ],
    reasoning: CLAUDE_REASONING,
    buildArgs: (model, effort): string[] => {
      const args: string[] = [];
      if (model) args.push('--model', model);
      if (effort) args.push('--effort', effort);
      return args;
    },
  },
  cursor: {
    // Cursor has no separate reasoning flag; the level is part of the model id,
    // so a base model + reasoning level compose a concrete `--model` value.
    models: cursorModelOptions(),
    buildArgs: buildCursorArgs,
  },
  amp: {
    // Amp selects the model through its agent "mode" (`--mode`) and exposes
    // `--effort` for the `smart` and `deep` modes; `rush` has no reasoning.
    models: [
      { id: 'smart', label: 'Smart' },
      { id: 'rush', label: 'Rush', reasoning: [] },
      { id: 'deep', label: 'Deep' },
    ],
    reasoning: AMP_REASONING,
    buildArgs: (model, effort): string[] => {
      const args: string[] = [];
      if (model) args.push('--mode', model);
      if (effort) args.push('--effort', effort);
      return args;
    },
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
 * Resolve the reasoning levels available for a given model selection.
 *
 * A model's own reasoning list (when defined) takes precedence over the
 * provider-level list, so model-specific availability (Cursor per family, Amp
 * `rush` vs `smart`/`deep`) is honored. Returns an empty array when the
 * provider/model exposes no reasoning selector.
 */
export function reasoningOptionsForModel(
  support: AgentModelSupport,
  modelId: string | undefined
): AgentReasoningOption[] {
  if (modelId) {
    const model = support.models.find((option) => option.id === modelId);
    if (model && model.reasoning !== undefined) return model.reasoning;
  }
  return support.reasoning ?? [];
}

/** Reasoning levels available for a provider + (optional) selected model. */
export function getReasoningOptions(
  providerId: AgentProviderId,
  modelId: string | undefined
): AgentReasoningOption[] {
  const support = getAgentModelSupport(providerId);
  if (!support) return [];
  return reasoningOptionsForModel(support, modelId);
}

/**
 * Translate a stored model selection into CLI arguments for the given provider.
 *
 * Returns an empty array when the provider has no curated model support or when
 * the selection is empty. Stored values are validated against the current
 * curated options (model ids, and reasoning ids for the selected model) before
 * being passed as discrete argv tokens (never through a shell), so stale
 * settings are ignored instead of breaking new sessions.
 */
export function buildAgentModelArgs(
  providerId: AgentProviderId,
  selection: AgentModelSelection | undefined
): string[] {
  const support = getAgentModelSupport(providerId);
  if (!support || !selection) return [];

  const rawModel = selection.model?.trim();
  const model =
    rawModel && support.models.some((option) => option.id === rawModel) ? rawModel : undefined;

  const rawEffort = selection.reasoningEffort?.trim();
  const reasoning = reasoningOptionsForModel(support, model);
  const effort =
    rawEffort && reasoning.some((option) => option.id === rawEffort) ? rawEffort : undefined;

  return support.buildArgs(model, effort);
}
