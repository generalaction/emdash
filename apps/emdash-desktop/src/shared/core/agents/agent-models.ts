import { AGENT_MODEL_SUPPORT } from './agent-model-support';
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
 * in `agent-model-support.ts`. Other providers fall back to their CLI/config
 * defaults.
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

export { AGENT_MODEL_SUPPORT };

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
