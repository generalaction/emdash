import { defineContract, fallible, liveLog, liveModel, liveState } from '@emdash/wire';
import { z } from 'zod';
import { ptyAgentErrorSchema, ptyAgentStartInputSchema, ptySessionListSchema } from './schemas';

const conv = z.object({ conversationId: z.string() });

export const ptyAgentContract = defineContract({
  /**
   * Spawns (or resumes) a provider CLI agent session in a PTY.
   * The server builds the provider command via `plugin.behavior.prompt.buildCommand(ctx)`.
   * Returns the resolved provider-native session id (persisted by the client
   * so future sessions can resume with the correct native id).
   */
  startSession: fallible({
    input: z.object({ input: ptyAgentStartInputSchema }),
    data: z.object({ sessionId: z.string() }),
    error: ptyAgentErrorSchema,
  }),

  /**
   * Terminates the process and clears desired state (no respawn).
   */
  stopSession: fallible({
    input: conv,
    data: z.void(),
    error: ptyAgentErrorSchema,
  }),

  /**
   * Writes raw bytes into the PTY stdin (mirrors rpc.pty.sendInput).
   */
  sendInput: fallible({
    input: conv.extend({ data: z.string() }),
    data: z.void(),
    error: ptyAgentErrorSchema,
  }),

  /**
   * Resizes the PTY window. Should be called whenever the terminal UI is resized.
   */
  resize: fallible({
    input: conv.extend({ cols: z.number().int(), rows: z.number().int() }),
    data: z.void(),
    error: ptyAgentErrorSchema,
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
      list: liveState({ data: ptySessionListSchema }),
    },
  }),
});

export type PtyAgentContract = typeof ptyAgentContract;
