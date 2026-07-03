/**
 * Core-owned session-config and usage data models.
 *
 * These are the materialized, plain-JSON output types produced by
 * AcpTranscriptParser for the non-transcript session/update stream variants
 * (config_option_update, usage_update, session_info_update, etc.). They mirror
 * the workspace-server contract shapes in schemas.ts but are owned here so
 * the parser stays dependency-free of the contract/Zod layer.
 *
 * No Date, Map, or Set — fully LiveModel-compatible.
 */

// ── Config option types ────────────────────────────────────────────────────

/**
 * A single selectable option in any config group (model, effort, mode).
 * `id` is the wire `value` from the ACP SessionConfigOption option list.
 */
export type SelectableOption = {
  id: string;
  name: string;
  description?: string;
};

/**
 * A model choice with optional benchmark/capability metadata.
 * `features` is absent until the provider starts populating it.
 */
export type ModelChoice = SelectableOption & {
  features?: {
    contextWindowSize?: number;
    speed?: number;
    intelligence?: number;
  };
};

/**
 * A slash command advertised by the agent via available_commands_update.
 * `inputHint` is the optional hint string from the ACP AvailableCommand.input.hint.
 */
export type SessionCommand = {
  name: string;
  description: string;
  inputHint?: string;
};

// ── SessionConfigState ─────────────────────────────────────────────────────

/**
 * Materialized view of session configuration derived from config_option_update,
 * current_mode_update, and available_commands_update notifications.
 *
 * Each group is null when the agent has not yet reported that category
 * (e.g. a provider with no model selector omits modelOptions entirely).
 *
 * Initial values come from outside (newSession/loadSession establishment
 * response merged by the runtime). The parser only applies delta updates.
 */
export type SessionConfigState = {
  /**
   * Model selection — null when the provider doesn't expose a model picker.
   * `selected` is the currentValue; `available` is the full options list.
   */
  modelOptions: { selected: string | null; available: ModelChoice[] } | null;
  /**
   * Effort/thought-level selection — null when the provider doesn't expose one.
   * Mapped from the ACP config option with category === 'thought_level'.
   */
  efforts: { selected: string | null; available: SelectableOption[] } | null;
  /**
   * Permission mode selection — null when the provider doesn't expose one.
   * Mapped from the ACP config option with category === 'mode'.
   */
  modeOptions: { selected: string | null; available: SelectableOption[] } | null;
  /** All slash commands currently advertised by the agent. */
  availableCommands: SessionCommand[];
};

/**
 * Returns an empty SessionConfigState — the parser's starting point before
 * any session/update notifications arrive.
 */
export function emptyConfig(): SessionConfigState {
  return {
    modelOptions: null,
    efforts: null,
    modeOptions: null,
    availableCommands: [],
  };
}

// ── SessionUsage ────────────────────────────────────────────────────────────

/**
 * Context-window consumption and cost figures from usage_update notifications.
 * Updated on every usage_update; null until the first notification arrives.
 */
export type SessionUsage = {
  /** Total context window capacity in tokens. */
  contextSize: number;
  /** Tokens currently consumed by this session. */
  contextUsed: number;
  /** Cumulative session cost, or null if the provider does not report cost. */
  cost: { amount: number; currency: string } | null;
};
