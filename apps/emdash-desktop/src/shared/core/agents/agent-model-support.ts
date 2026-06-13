import type { AgentModelOption, AgentModelSupport, AgentReasoningOption } from './agent-models';
import type { AgentProviderId } from './agent-provider-registry';

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
 * Curated model + reasoning support for providers with predictable model flags.
 *
 * Keep this as provider data/translation only. The public model-selection API
 * lives in `agent-models.ts`, so volatile provider catalogs do not obscure the
 * validation and settings boundary.
 */
export const AGENT_MODEL_SUPPORT = {
  codex: {
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
    models: cursorModelOptions(),
    buildArgs: buildCursorArgs,
  },
  amp: {
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
