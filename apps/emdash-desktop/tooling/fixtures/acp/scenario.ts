/**
 * Ordered scenario for ACP transcript fixture generation.
 *
 * Each step is either a user `prompt` sent via session/prompt, or a control
 * action (setModel / setEffort / setMode) that exercises the config-option and
 * mode update surfaces.
 *
 * The scenario is designed to exercise (nearly) the full ACP SessionUpdate
 * event surface in a single session against the emdash repo:
 *
 *  Step 1  → agent_message_chunk, turn boundary
 *  Step 2  → agent_thought_chunk, tool_call (readFile), tool_call_update, message, resource_link?
 *  Step 3  → tool_call (search/grep), message
 *  Step 4  → multiple tool_call (read), message
 *  Step 5  → config_option_update (setModel control action)
 *  Step 6  → config_option_update (setEffort / thought_level control action)
 *  Step 7  → plan / plan_update (+ thought)
 *  Step 8  → tool_call (execute), createTerminal, terminal output, waitForTerminalExit, requestPermission
 *  Step 9  → second execute / terminal
 *  Step 10 → tool_call (edit/new-file), requestPermission, writeTextFile
 *  Step 11 → tool_call (edit/append), writeTextFile
 *  Step 12 → tool_call (move + delete)
 *  Step 13 → nested/subagent tool calls (parentToolCallId surface)
 *  Step 14 → current_mode_update (setMode control action)
 *  Step 15 → long multi-chunk agent_message_chunk
 *
 * usage_update and available_commands_update are emitted passively by the
 * agent and captured by the recording client without needing an explicit step.
 */

import type {
  SessionConfigOption,
  SessionConfigSelectOptions,
  SessionMode,
} from '@agentclientprotocol/sdk';

/** Re-exported under the shorter alias used by callers. */
export type ConfigOption = SessionConfigOption;
export type { SessionMode };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptStep {
  kind: 'prompt';
  text: string;
}

/**
 * Resolve a model value dynamically from the initial session config options.
 * The callback receives the initialConfigOptions array and should return a model
 * string that is a valid option for this provider, or null to skip.
 */
export interface SetModelStep {
  kind: 'setModel';
  /**
   * Pick a model from the initialConfigOptions returned by newSession.
   * Called at runtime with the configOptions array; return the model string or
   * null to skip this step if no suitable alternative is found.
   */
  resolveModel: (configOptions: SessionConfigOption[]) => string | null;
}

/** Adjust the effort / thought_level config option, if advertised. */
export interface SetEffortStep {
  kind: 'setEffort';
  /** Pick an effort value. Receives the advertised effort options if any. */
  resolveEffort: (configOptions: SessionConfigOption[]) => string | null;
}

/** Switch to a different session mode, if the agent advertises more than one. */
export interface SetModeStep {
  kind: 'setMode';
  /** Receives the modes list; return a modeId to switch to or null to skip. */
  resolveMode: (modes: SessionMode[]) => string | null;
}

export type ScenarioStep = PromptStep | SetModelStep | SetEffortStep | SetModeStep;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flatten grouped or flat SelectOptions to a uniform `{ value: string }[]`. */
function flattenSelectOptions(options: SessionConfigSelectOptions): { value: string }[] {
  return (options as ({ value: string } | { options: { value: string }[] })[]).flatMap((o) =>
    'options' in o ? o.options : [o]
  );
}

function pickDifferentModel(configOptions: SessionConfigOption[]): string | null {
  const modelConfig = configOptions.find(
    (c) =>
      c.category === 'model' ||
      c.id === 'model' ||
      c.id.toLowerCase().includes('model')
  );
  if (!modelConfig || modelConfig.type !== 'select') return null;
  const current = modelConfig.currentValue;
  const alt = flattenSelectOptions(modelConfig.options).find((o) => o.value !== current);
  return alt?.value ?? null;
}

function pickEffortValue(configOptions: SessionConfigOption[]): string | null {
  const effortConfig = configOptions.find(
    (c) =>
      c.category === 'thought_level' ||
      c.id === 'thought_level' ||
      c.id === 'effort' ||
      c.id.toLowerCase().includes('effort') ||
      c.id.toLowerCase().includes('thinking')
  );
  if (!effortConfig || effortConfig.type !== 'select') return null;
  const current = effortConfig.currentValue;
  const alt = flattenSelectOptions(effortConfig.options).find((o) => o.value !== current);
  return alt?.value ?? null;
}

function pickDifferentMode(modes: SessionMode[]): string | null {
  if (modes.length < 2) return null;
  const alt = modes[1];
  return alt?.id ?? null;
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export const scenario: ScenarioStep[] = [
  // Step 1 — plain text answer, no tools
  {
    kind: 'prompt',
    text: 'In one sentence, without reading any files, what is emdash?',
  },

  // Step 2 — read AGENTS.md, thought + tool_call(read) + message + resource_link
  {
    kind: 'prompt',
    text:
      'Think about how to explore this repo, then read `AGENTS.md` and give me the ' +
      'Repository Structure section as exactly 3 bullet points.',
  },

  // Step 3 — search / grep tool
  {
    kind: 'prompt',
    text:
      'Search the codebase for the definition of `toAgentUpdate` — give the file path and line number.',
  },

  // Step 4 — multiple read tool calls (multi-file surface)
  {
    kind: 'prompt',
    text:
      'Read `packages/core/src/acp/agent-update.ts` and ' +
      '`packages/core/src/acp/session-machine.ts`, then explain in two sentences how they relate.',
  },

  // Step 5 — setModel control action → config_option_update
  {
    kind: 'setModel',
    resolveModel: pickDifferentModel,
  },

  // Step 6 — setEffort / thought_level control action → config_option_update
  {
    kind: 'setEffort',
    resolveEffort: pickEffortValue,
  },

  // Step 7 — checklist plan (plan / plan_update + thought)
  {
    kind: 'prompt',
    text:
      'Make a checklist / todo plan for adding an optional `foo: string` field to AgentUpdate. ' +
      'Do NOT edit any files.',
  },

  // Step 8 — execute tool → createTerminal + terminal output + waitForTerminalExit + requestPermission
  {
    kind: 'prompt',
    text: 'Run `git rev-parse --abbrev-ref HEAD` and tell me the current branch name.',
  },

  // Step 9 — second execute / terminal
  {
    kind: 'prompt',
    text: 'Run `ls packages` and list the workspace package names.',
  },

  // Step 10 — create new file (edit with oldText null) + permission + writeTextFile
  {
    kind: 'prompt',
    text:
      'Create the file `.acp-fixture-scratch/NOTES.md` containing exactly this line: ' +
      '`# ACP fixture notes`',
  },

  // Step 11 — append to file (edit with oldText present) + writeTextFile
  {
    kind: 'prompt',
    text:
      'Append the line `generated by fixture script` to `.acp-fixture-scratch/NOTES.md`.',
  },

  // Step 12 — rename + delete (move + delete file-op kinds)
  {
    kind: 'prompt',
    text:
      'Rename `.acp-fixture-scratch/NOTES.md` to `.acp-fixture-scratch/NOTES2.md`, ' +
      'then delete `.acp-fixture-scratch/NOTES2.md`.',
  },

  // Step 13 — subagent / Task tool to exercise parentToolCallId surface
  {
    kind: 'prompt',
    text:
      'Use a subagent (Task tool) to find all files under `packages/core/src/acp` that ' +
      'contain the string `stopReason`, then summarize what each file does.',
  },

  // Step 14 — setMode control action → current_mode_update
  {
    kind: 'setMode',
    resolveMode: pickDifferentMode,
  },

  // Step 15 — long multi-chunk message
  {
    kind: 'prompt',
    text:
      'Explain the ACP session lifecycle in detail, using markdown headings for each phase ' +
      'and including a fenced code block showing an example sequence of events.',
  },
];
