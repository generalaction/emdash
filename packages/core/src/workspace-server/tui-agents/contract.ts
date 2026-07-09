import { defineContract, fallible, liveLog, liveModel, liveState } from '@emdash/wire';
import { z } from 'zod';
import {
  tuiAgentErrorSchema,
  tuiAgentStartInputSchema,
  tuiHookEventInputSchema,
  tuiNotificationListSchema,
  tuiResumeOutcomeSchema,
  tuiSessionListSchema,
} from './schemas';

const conv = z.object({ conversationId: z.string() });

export const tuiAgentsContract = defineContract({
  /**
   * Registers fresh-start intent for a provider CLI agent session.
   *
   * The process is spawned when the output log is attached; if it is already
   * running, this call only updates intent/config without respawning.
   */
  startSession: fallible({
    input: z.object({ input: tuiAgentStartInputSchema }),
    data: z.void(),
    error: tuiAgentErrorSchema,
  }),

  /**
   * Registers resume intent for a provider CLI agent session.
   *
   * The server builds the provider command via `plugin.behavior.prompt.buildCommand(ctx)`.
   * Provider-native session id changes are published through the sessions LiveModel.
   */
  resumeSession: fallible({
    input: z.object({ input: tuiAgentStartInputSchema }),
    data: z.object({ outcome: tuiResumeOutcomeSchema }),
    error: tuiAgentErrorSchema,
  }),

  /**
   * Terminates the process immediately and marks desired state as stopped.
   * Retained output and last session state remain available.
   */
  stopSession: fallible({
    input: conv,
    data: z.void(),
    error: tuiAgentErrorSchema,
  }),

  /**
   * Terminates any process and purges retained output, session state, and notifications.
   */
  deleteSession: fallible({
    input: conv,
    data: z.void(),
    error: tuiAgentErrorSchema,
  }),

  /**
   * Writes raw bytes into the PTY stdin (mirrors rpc.pty.sendInput).
   */
  sendInput: fallible({
    input: conv.extend({ data: z.string() }),
    data: z.void(),
    error: tuiAgentErrorSchema,
  }),

  /**
   * Resizes the PTY window. Should be called whenever the terminal UI is resized.
   */
  resize: fallible({
    input: conv.extend({ cols: z.number().int(), rows: z.number().int() }),
    data: z.void(),
    error: tuiAgentErrorSchema,
  }),

  /**
   * Host-owned hook servers forward raw provider lifecycle events here.
   */
  emitHookEvent: fallible({
    input: tuiHookEventInputSchema,
    data: z.void(),
    error: tuiAgentErrorSchema,
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
   * Reactive global notification list (keyed by conversationId).
   */
  notifications: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: tuiNotificationListSchema }),
    },
  }),
});

export type TuiAgentsContract = typeof tuiAgentsContract;
