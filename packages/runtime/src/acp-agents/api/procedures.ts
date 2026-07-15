import type {
  AcpAttachmentError,
  AcpCancelTurnError,
  AcpChangeQueuePromptOrderError,
  AcpDeleteQueuedPromptError,
  AcpEditQueuedPromptError,
  AcpExportRawLogError,
  AcpExportTranscriptError,
  AcpGetHistoryError,
  AcpQueuePromptError,
  AcpResolvePermissionError,
  AcpResumeSessionError,
  AcpSendPromptError,
  AcpSetModeOptionError,
  AcpSetModelOptionError,
  AcpSetPromptDraftError,
  AcpStartSessionError,
  AcpStopSessionError,
  AcpStartInputWire,
  AttachmentMimeType,
  AttachmentRef,
  HistoryPage,
  PromptDraftUpdate,
  PromptInput,
  ResumeResult,
} from '@emdash/core/acp';
import { ok, type Result } from '@emdash/shared';
import { blobSourceFromBytes, type WireFile } from '@emdash/wire';
import type { AcpRuntime } from '../runtime/runtime';

export type StartSessionInput = AcpStartInputWire;

export function createAcpProcedures(runtime: AcpRuntime) {
  return {
    startSession(input: {
      input: StartSessionInput;
    }): Promise<Result<{ sessionId: string }, AcpStartSessionError>> {
      return runtime.startSession(input.input);
    },
    resumeSession(input: {
      input: StartSessionInput & { sessionId: string };
    }): Promise<Result<ResumeResult, AcpResumeSessionError>> {
      return runtime.resumeSession(input.input);
    },
    stopSession(input: { conversationId: string }): Result<void, AcpStopSessionError> {
      return runtime.stopSession(input.conversationId);
    },
    sendPrompt(input: {
      conversationId: string;
      prompt: PromptInput;
    }): Promise<Result<{ queued: boolean }, AcpSendPromptError>> {
      return runtime.sendPrompt(input.conversationId, input.prompt);
    },
    queuePrompt(input: {
      conversationId: string;
      prompt: PromptInput;
    }): Result<{ queued: boolean }, AcpQueuePromptError> {
      return runtime.queuePrompt(input.conversationId, input.prompt);
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
    setPromptDraft(input: {
      conversationId: string;
      draft: PromptDraftUpdate;
    }): Result<void, AcpSetPromptDraftError> {
      return runtime.setPromptDraft(input.conversationId, input.draft);
    },
    setModelOption(input: {
      conversationId: string;
      dimension: 'model' | 'effort' | 'fastMode';
      value: string;
    }): Promise<Result<void, AcpSetModelOptionError>> {
      return runtime.setModelOption(input.conversationId, input.dimension, input.value);
    },
    setModeOption(input: {
      conversationId: string;
      value: string;
    }): Promise<Result<void, AcpSetModeOptionError>> {
      return runtime.setModeOption(input.conversationId, input.value);
    },
    resolvePermission(input: {
      conversationId: string;
      requestId: string;
      optionId: string;
    }): Result<void, AcpResolvePermissionError> {
      return runtime.resolvePermission(input.conversationId, input.requestId, input.optionId);
    },
    exportACPTranscript(input: {
      conversationId: string;
    }): Result<string, AcpExportTranscriptError> {
      return runtime.exportParsedTranscript(input.conversationId);
    },
    exportRawAcpLog(input: { conversationId: string }): Result<string, AcpExportRawLogError> {
      return runtime.exportRawAcpLog(input.conversationId);
    },
    async uploadAttachment(
      input: {
        originalPath?: string;
      },
      file: WireFile
    ): Promise<Result<AttachmentRef, AcpAttachmentError>> {
      const data = input.originalPath ? undefined : await file.bytes();
      return runtime.uploadAttachment({
        data,
        mimeType: file.mimeType as AttachmentMimeType,
        name: file.name,
        originalPath: input.originalPath,
      });
    },
    async downloadAttachment(input: {
      id: string;
    }): Promise<
      Result<{ meta: AttachmentRef; source: AsyncIterable<Uint8Array> }, AcpAttachmentError>
    > {
      const result = await runtime.downloadAttachment(input.id);
      if (!result.success) return result;
      return ok({
        meta: result.data.ref,
        source: blobSourceFromBytes(result.data.data),
      });
    },
    deleteAttachment(input: { id: string }): Promise<Result<void, AcpAttachmentError>> {
      return runtime.deleteAttachment(input.id);
    },
    getHistory(input: {
      conversationId: string;
      before?: number;
      limit: number;
    }): Result<HistoryPage, AcpGetHistoryError> {
      return runtime.getHistory(input.conversationId, input.before, input.limit);
    },
  };
}

export type AcpProcedures = ReturnType<typeof createAcpProcedures>;
