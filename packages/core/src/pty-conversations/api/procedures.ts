import type { Result } from '@emdash/shared';
import type { PtyAgentError, PtyAgentStartInput } from './schemas';
import type { PtyConversationsRuntime } from '../runtime/runtime';

export function createPtyAgentProcedures(runtime: PtyConversationsRuntime) {
  return {
    startSession(input: {
      input: PtyAgentStartInput;
    }): Promise<Result<{ sessionId: string; alreadyRunning?: boolean }, PtyAgentError>> {
      return runtime.startSession(input.input);
    },

    stopSession(input: { conversationId: string }): Result<void, PtyAgentError> {
      return runtime.stopSession(input.conversationId);
    },

    disposeSession(input: { conversationId: string }): Result<void, PtyAgentError> {
      return runtime.disposeSession(input.conversationId);
    },

    sendInput(input: { conversationId: string; data: string }): Result<void, PtyAgentError> {
      return runtime.sendInput(input.conversationId, input.data);
    },

    resize(input: {
      conversationId: string;
      cols: number;
      rows: number;
    }): Result<void, PtyAgentError> {
      return runtime.resize(input.conversationId, input.cols, input.rows);
    },
  };
}

export type PtyAgentProcedures = ReturnType<typeof createPtyAgentProcedures>;
