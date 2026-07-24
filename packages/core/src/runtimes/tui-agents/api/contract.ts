import { defineContract, fallible, liveLog, liveModel, liveState } from '@emdash/wire';
import { z } from 'zod';
import {
  tuiAgentStartInputSchema,
  tuiAgentStateListSchema,
  tuiInputErrorSchema,
  tuiResumeOutcomeSchema,
  tuiResumeSessionErrorSchema,
  tuiSessionControlErrorSchema,
  tuiSessionListSchema,
  tuiStartOutcomeSchema,
  tuiStartSessionErrorSchema,
} from './schemas';

const conv = z.object({ conversationId: z.string() });

export const tuiAgentsContract = defineContract({
  /**
   * Starts a fresh provider CLI agent session and resolves after PTY creation.
   *
   * If the process is already running or another launch won the race, this call
   * returns `attached` without replacing the active config.
   */
  startSession: fallible({
    input: z.object({ input: tuiAgentStartInputSchema }),
    data: z.object({ outcome: tuiStartOutcomeSchema }),
    error: tuiStartSessionErrorSchema,
  }),

  /**
   * Resumes a provider CLI agent session and resolves after PTY creation.
   *
   * The server builds the provider command via `plugin.behavior.prompt.buildCommand(ctx)`.
   * Provider-native session id changes are published through the sessions LiveModel.
   * Missing provider session ids are downgraded to a fresh spawn and reported as
   * `fresh-fallback`.
   */
  resumeSession: fallible({
    input: z.object({ input: tuiAgentStartInputSchema }),
    data: z.object({ outcome: tuiResumeOutcomeSchema }),
    error: tuiResumeSessionErrorSchema,
  }),

  /**
   * Terminates the process immediately and marks desired state as stopped.
   * Retained output and last session state remain available.
   */
  stopSession: fallible({
    input: conv,
    data: z.void(),
    error: tuiSessionControlErrorSchema,
  }),

  /**
   * Deactivates a session so it disappears from active runtime state while
   * remaining resumable from its persisted conversation/session id.
   */
  deactivateSession: fallible({
    input: conv,
    data: z.void(),
    error: tuiSessionControlErrorSchema,
  }),

  /**
   * Terminates any process and purges retained output, session state, and agent state.
   */
  deleteSession: fallible({
    input: conv,
    data: z.void(),
    error: tuiSessionControlErrorSchema,
  }),

  /**
   * Terminates any active process and removes the persisted active intent.
   * The conversation row remains available as an inactive/resumable record.
   */
  killSession: fallible({
    input: conv,
    data: z.void(),
    error: tuiSessionControlErrorSchema,
  }),

  /**
   * Writes raw bytes into the PTY stdin (mirrors rpc.pty.sendInput).
   */
  sendInput: fallible({
    input: conv.extend({ data: z.string() }),
    data: z.void(),
    error: tuiInputErrorSchema,
  }),

  /**
   * Resizes the PTY window. Should be called whenever the terminal UI is resized.
   */
  resize: fallible({
    input: conv.extend({ cols: z.number().int(), rows: z.number().int() }),
    data: z.void(),
    error: tuiInputErrorSchema,
  }),

  /**
   * Streams PTY output for a session through a retained wire log.
   */
  output: liveLog({ key: conv }),

  /**
   * Reactive global session list (keyed by conversationId).
   * No key argument — one global model for all active PTY agent sessions.
   * Mirrors acp.sessionStateList pattern.
   */
  sessions: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: tuiSessionListSchema }),
    },
  }),

  /**
   * Reactive global agent state list (keyed by conversationId).
   */
  agentStates: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: tuiAgentStateListSchema }),
    },
  }),
});

export type TuiAgentsContract = typeof tuiAgentsContract;
