import { ok, type Result, type SerializedError } from '@emdash/shared';
import type {
  AcpCancelTurnError,
  AcpChangeQueuePromptOrderError,
  AcpDeleteQueuedPromptError,
  AcpEditQueuedPromptError,
  AcpExportRawLogError,
  AcpExportTranscriptError,
  AcpLoadHistoryError,
  AcpResolvePermissionError,
  AcpSendPromptError,
  AcpSetOptionError,
  AcpSessionStartMode,
  AcpStartInputWire,
  AcpTerminateError,
  LoadHistoryResult,
  PromptInput,
  PromptPlacement,
} from '#runtimes/acp/api';
import { acpErr } from '#runtimes/acp/api';
import type { AcpRuntime } from '#runtimes/acp/node/runtime/runtime';
import { isAcpWakeFailure, type AcpWakeFailure } from '#runtimes/acp/node/runtime/session-manager';

export type SessionDescriptorInput = AcpStartInputWire;

export function createAcpProcedures(runtime: AcpRuntime) {
  return {
    attach(input: SessionDescriptorInput): ReturnType<AcpRuntime['attachSession']> {
      return runtime.attachSession(input);
    },
    startSession(
      input: SessionDescriptorInput & { mode: AcpSessionStartMode }
    ): ReturnType<AcpRuntime['startSession']> {
      const { mode, ...descriptor } = input;
      return runtime.startSession(descriptor, mode);
    },
    terminate(input: { conversationId: string }): Promise<Result<void, AcpTerminateError>> {
      return runtime.terminateSession(input.conversationId);
    },
    sendPrompt(input: {
      conversationId: string;
      promptId: string;
      prompt: PromptInput;
      placement?: PromptPlacement;
    }): Promise<Result<{ queued: boolean }, AcpSendPromptError>> {
      return runtime.sendPrompt(
        input.conversationId,
        input.prompt,
        input.placement,
        input.promptId
      );
    },
    editQueuedPrompt(input: {
      conversationId: string;
      id: string;
      input: PromptInput;
    }): Result<void, AcpEditQueuedPromptError> {
      return runtime.editQueuedPrompt(input.conversationId, input.id, input.input);
    },
    deleteQueuedPrompt(input: {
      conversationId: string;
      id: string;
    }): Result<void, AcpDeleteQueuedPromptError> {
      return runtime.deleteQueuedPrompt(input.conversationId, input.id);
    },
    changeQueuePromptOrder(input: {
      conversationId: string;
      ids: string[];
    }): Result<void, AcpChangeQueuePromptOrderError> {
      return runtime.changeQueuePromptOrder(input.conversationId, input.ids);
    },
    cancelTurn(input: { conversationId: string }): Promise<Result<void, AcpCancelTurnError>> {
      return runtime.cancelTurn(input.conversationId);
    },
    async setOption(input: {
      conversationId: string;
      key: 'model' | 'mode' | 'effort' | 'collaborationMode';
      value: string;
    }): Promise<Result<void, AcpSetOptionError>> {
      const result = await runtime.setOption(input.conversationId, input.key, input.value);
      if (!result.success && isAcpWakeFailure(result.error)) {
        return input.key === 'mode'
          ? acpErr.setModeFailed(wakeFailureCause(result.error))
          : acpErr.setConfigFailed(wakeFailureCause(result.error));
      }
      return result as Result<void, AcpSetOptionError>;
    },
    resolvePermission(input: {
      conversationId: string;
      requestId: string;
      optionId: string;
    }): Result<void, AcpResolvePermissionError> {
      return runtime.resolvePermission(input.conversationId, input.requestId, input.optionId);
    },
    exportAcpTranscript(input: {
      conversationId: string;
    }): Result<{ transcript: string }, AcpExportTranscriptError> {
      const result = runtime.exportParsedTranscript(input.conversationId);
      return result.success ? ok({ transcript: result.data }) : result;
    },
    exportRawAcpLog(input: {
      conversationId: string;
    }): Result<{ log: string }, AcpExportRawLogError> {
      const result = runtime.exportRawAcpLog(input.conversationId);
      return result.success ? ok({ log: result.data }) : result;
    },
    loadHistory(input: {
      conversationId: string;
      before?: number;
      limit: number;
    }): Promise<Result<LoadHistoryResult, AcpLoadHistoryError>> {
      return runtime.loadHistory(input.conversationId, input.before, input.limit);
    },
  };
}

export type AcpProcedures = ReturnType<typeof createAcpProcedures>;

function wakeFailureCause(failure: AcpWakeFailure): SerializedError {
  if ('cause' in failure.error && failure.error.cause) return failure.error.cause;
  return {
    name: 'AcpStartError',
    message: failure.error.message ?? failure.error.type,
  };
}
