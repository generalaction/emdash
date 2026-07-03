import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { createLiveModelContract } from '../../live-model';
import {
  ptyAgentStartInputSchema,
  ptyOutputEventSchema,
  ptySessionListSchema,
  ptyStartedResultSchema,
  ptyVoidResultSchema,
} from './schemas';

const conv = z.object({ conversationId: z.string() });

export const ptyAgentContract = {
  /**
   * Spawns (or resumes) a provider CLI agent session in a PTY.
   * The server builds the provider command via `plugin.behavior.prompt.buildCommand(ctx)`.
   * Returns the resolved provider-native session id (persisted by the client
   * so future sessions can resume with the correct native id).
   */
  startSession: oc
    .input(z.object({ input: ptyAgentStartInputSchema }))
    .output(ptyStartedResultSchema),

  /**
   * Terminates the process and clears desired state (no respawn).
   */
  stopSession: oc.input(conv).output(ptyVoidResultSchema),

  /**
   * Writes raw bytes into the PTY stdin (mirrors rpc.pty.sendInput).
   */
  sendInput: oc.input(conv.extend({ data: z.string() })).output(ptyVoidResultSchema),

  /**
   * Resizes the PTY window. Should be called whenever the terminal UI is resized.
   */
  resize: oc
    .input(conv.extend({ cols: z.number().int(), rows: z.number().int() }))
    .output(ptyVoidResultSchema),

  /**
   * Streams PTY output for a session.
   * The optional `offset` requests replay starting from that byte position in
   * the ring buffer; the server emits a `reset` event if the offset is stale.
   * Terminates with an `exit` event when the process exits.
   */
  subscribeOutput: oc
    .input(conv.extend({ offset: z.number().int().optional() }))
    .output(eventIterator(ptyOutputEventSchema)),

  /**
   * Reactive global session list (keyed by conversationId).
   * No key argument — one global model for all active PTY agent sessions.
   * Mirrors acp.sessionStateList pattern.
   */
  sessions: createLiveModelContract(ptySessionListSchema),
};

export type PtyAgentContract = typeof ptyAgentContract;
