import { defineContract, fallible, liveLog, liveModel, liveState } from '@emdash/wire';
import { terminalShellAvailabilityListSchema } from '@primitives/terminal-shell/api';
import {
  scriptWorkflowsDefinitions,
  terminalErrorSchema,
  terminalScopeInputSchema,
} from '@services/script-workflows/api';
import { z } from 'zod';
import {
  startTerminalInputSchema,
  scriptWorkflowStateSchema,
  killTmuxSessionsInputSchema,
  tmuxSessionListSchema,
  terminalControlInputSchema,
  terminalDataInputSchema,
  terminalDevServerListSchema,
  terminalKeySchema,
  terminalResizeInputSchema,
  terminalSessionListSchema,
} from './schemas';

export const terminalsContract = defineContract({
  ...scriptWorkflowsDefinitions,
  startTerminal: fallible({
    input: startTerminalInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
  getShellAvailability: fallible({
    input: z.void().optional(),
    data: terminalShellAvailabilityListSchema,
    error: terminalErrorSchema,
  }),
  workflows: liveModel({
    key: terminalScopeInputSchema,
    states: {
      state: liveState({ data: scriptWorkflowStateSchema.nullable() }),
    },
  }),
  output: liveLog({
    key: terminalKeySchema,
  }),
  sessions: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: terminalSessionListSchema }),
    },
  }),
  devServers: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: terminalDevServerListSchema }),
    },
  }),
  sendInput: fallible({
    input: terminalDataInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
  resize: fallible({
    input: terminalResizeInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
  kill: fallible({
    input: terminalControlInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
  killTmuxSessions: fallible({
    input: killTmuxSessionsInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
  listTmuxSessions: fallible({
    input: z.void().optional(),
    data: tmuxSessionListSchema,
    error: terminalErrorSchema,
  }),
});

export type TerminalsContract = typeof terminalsContract;
