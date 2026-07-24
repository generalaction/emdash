import type { Result } from '@emdash/shared';
import type {
  TuiAgentStartInput,
  TuiInputError,
  TuiResumeOutcome,
  TuiResumeSessionError,
  TuiSessionControlError,
  TuiStartOutcome,
  TuiStartSessionError,
} from '@runtimes/tui-agents/api';
import type { TuiAgentsRuntime } from '@runtimes/tui-agents/node/runtime/runtime';

export type StartTuiSessionInput = TuiAgentStartInput;

export function createTuiAgentsProcedures(runtime: TuiAgentsRuntime) {
  return {
    startSession(input: {
      input: StartTuiSessionInput;
    }): Promise<Result<{ outcome: TuiStartOutcome }, TuiStartSessionError>> {
      return runtime.startSession(input.input);
    },
    resumeSession(input: {
      input: StartTuiSessionInput;
    }): Promise<Result<{ outcome: TuiResumeOutcome }, TuiResumeSessionError>> {
      return runtime.resumeSession(input.input);
    },
    stopSession(input: { conversationId: string }): Result<void, TuiSessionControlError> {
      return runtime.stopSession(input.conversationId);
    },
    deactivateSession(input: { conversationId: string }): Result<void, TuiSessionControlError> {
      return runtime.deactivateSession(input.conversationId, 'user');
    },
    deleteSession(input: { conversationId: string }): Result<void, TuiSessionControlError> {
      return runtime.deleteSession(input.conversationId);
    },
    killSession(input: { conversationId: string }): Result<void, TuiSessionControlError> {
      return runtime.killSession(input.conversationId);
    },
    sendInput(input: { conversationId: string; data: string }): Result<void, TuiInputError> {
      return runtime.sendInput(input.conversationId, input.data);
    },
    resize(input: {
      conversationId: string;
      cols: number;
      rows: number;
    }): Result<void, TuiInputError> {
      return runtime.resize(input.conversationId, input.cols, input.rows);
    },
  };
}

export type TuiAgentsProcedures = ReturnType<typeof createTuiAgentsProcedures>;
