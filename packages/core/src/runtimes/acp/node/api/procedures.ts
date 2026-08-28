import { ok, type Result, type SerializedError } from '@emdash/shared';
import { blobSourceFromBytes, type WireFile } from '@emdash/wire/rpc';
import type {
  AcpAttachmentError,
  AcpCancelTurnError,
  AcpChangeQueuePromptOrderError,
  AcpDeleteQueuedPromptError,
  AcpEditQueuedPromptError,
  AcpExportRawLogError,
  AcpExportTranscriptError,
  AcpLoadHistoryError,
  AcpPurgeConversationDataError,
  AcpResolvePermissionError,
  AcpSendPromptError,
  AcpSetOptionError,
  AcpStartError,
  AcpStartInputWire,
  AcpTerminateError,
  AttachmentMimeType,
  AttachmentRef,
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
    attach(input: SessionDescriptorInput): Promise<Result<void, AcpStartError>> {
      return runtime.attachSession(input);
    },
    launch(input: SessionDescriptorInput): ReturnType<AcpRuntime['launchSession']> {
      return runtime.launchSession(input);
    },
    terminate(input: { conversationId: string }): Promise<Result<void, AcpTerminateError>> {
      return runtime.terminateSession(input.conversationId);
    },
    async sendPrompt(input: {
      conversationId: string;
      prompt: PromptInput;
      placement?: PromptPlacement;
    }): Promise<Result<{ queued: boolean }, AcpSendPromptError>> {
      const result = await runtime.sendPrompt(input.conversationId, input.prompt, input.placement);
      if (!result.success && isAcpWakeFailure(result.error)) {
        return acpErr.promptFailed(wakeFailureCause(result.error));
      }
      return result as Result<{ queued: boolean }, AcpSendPromptError>;
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
      key: 'model' | 'mode' | 'effort';
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
    async uploadAttachment(
      input: {
        conversationId: string;
        originalPath?: string;
      },
      file: WireFile
    ): Promise<Result<AttachmentRef, AcpAttachmentError>> {
      const data = input.originalPath ? undefined : await file.bytes();
      return runtime.uploadAttachment({
        conversationId: input.conversationId,
        data,
        mimeType: file.mimeType as AttachmentMimeType,
        name: file.name,
        originalPath: input.originalPath,
      });
    },
    async downloadAttachment(input: {
      conversationId: string;
      attachmentId: string;
    }): Promise<
      Result<{ meta: AttachmentRef; source: AsyncIterable<Uint8Array> }, AcpAttachmentError>
    > {
      const result = await runtime.downloadAttachment(input.conversationId, input.attachmentId);
      if (!result.success) return result;
      return ok({
        meta: result.data.ref,
        source: blobSourceFromBytes(result.data.data),
      });
    },
    deleteAttachment(input: {
      conversationId: string;
      attachmentId: string;
    }): Promise<Result<void, AcpAttachmentError>> {
      return runtime.deleteAttachment(input.conversationId, input.attachmentId);
    },
    purgeConversationData(input: {
      conversationId: string;
    }): Promise<Result<void, AcpPurgeConversationDataError>> {
      return runtime.purgeConversationData(input.conversationId);
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
