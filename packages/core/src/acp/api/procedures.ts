import { ok, type Result } from '@emdash/shared';
import type { WireFile } from '@emdash/wire';
import type { AcpRuntimeError } from '../errors';
import type { AttachmentMimeType, AttachmentRef } from '../models/attachments';
import type { PromptDraftUpdate, PromptInput } from '../models/prompt';
import type { AcpRuntime } from '../runtime/runtime';
import type { AcpStartInput } from '../runtime/types';
import type { AcpStartInputWire } from './commands';
import type { HistoryPage, ResumeResult } from './queries';

export type StartSessionInput = AcpStartInputWire;

export function createAcpProcedures(runtime: AcpRuntime) {
  return {
    startSession(input: {
      input: StartSessionInput;
    }): Promise<Result<{ sessionId: string }, AcpRuntimeError>> {
      return runtime.startSession(toStartInput(input.input));
    },
    resumeSession(input: {
      input: StartSessionInput & { sessionId: string };
    }): Promise<Result<ResumeResult, AcpRuntimeError>> {
      return runtime.resumeSession({
        ...toStartInput(input.input),
        sessionId: input.input.sessionId,
      });
    },
    stopSession(input: { conversationId: string }): Result<void, AcpRuntimeError> {
      return runtime.stopSession(input.conversationId);
    },
    sendPrompt(input: {
      conversationId: string;
      prompt: PromptInput;
    }): Promise<Result<{ queued: boolean }, AcpRuntimeError>> {
      return runtime.sendPrompt(input.conversationId, input.prompt);
    },
    queuePrompt(input: {
      conversationId: string;
      prompt: PromptInput;
    }): Result<{ queued: boolean }, AcpRuntimeError> {
      return runtime.queuePrompt(input.conversationId, input.prompt);
    },
    editQueuedPrompt(input: {
      conversationId: string;
      id: string;
      input: PromptInput;
    }): Result<void, AcpRuntimeError> {
      return runtime.editQueuedPrompt(input.conversationId, input.id, input.input);
    },
    deleteQueuedPrompt(input: {
      conversationId: string;
      id: string;
    }): Result<void, AcpRuntimeError> {
      return runtime.deleteQueuedPrompt(input.conversationId, input.id);
    },
    changeQueuePromptOrder(input: {
      conversationId: string;
      ids: string[];
    }): Result<void, AcpRuntimeError> {
      return runtime.changeQueuePromptOrder(input.conversationId, input.ids);
    },
    cancelTurn(input: { conversationId: string }): Promise<Result<void, AcpRuntimeError>> {
      return runtime.cancelTurn(input.conversationId);
    },
    setPromptDraft(input: {
      conversationId: string;
      draft: PromptDraftUpdate;
    }): Result<void, AcpRuntimeError> {
      return runtime.setPromptDraft(input.conversationId, input.draft);
    },
    setModelOption(input: {
      conversationId: string;
      dimension: 'model' | 'effort';
      value: string;
    }): Promise<Result<void, AcpRuntimeError>> {
      return runtime.setModelOption(input.conversationId, input.dimension, input.value);
    },
    setModeOption(input: {
      conversationId: string;
      value: string;
    }): Promise<Result<void, AcpRuntimeError>> {
      return runtime.setModeOption(input.conversationId, input.value);
    },
    resolvePermission(input: {
      conversationId: string;
      requestId: string;
      optionId: string;
    }): Result<void, AcpRuntimeError> {
      return runtime.resolvePermission(input.conversationId, input.requestId, input.optionId);
    },
    exportACPTranscript(input: { conversationId: string }): Result<string, AcpRuntimeError> {
      return runtime.exportParsedTranscript(input.conversationId);
    },
    exportRawAcpLog(input: { conversationId: string }): Result<string, AcpRuntimeError> {
      return runtime.exportRawAcpLog(input.conversationId);
    },
    async uploadAttachment(
      input: {
        originalPath?: string;
      },
      file: WireFile
    ): Promise<Result<AttachmentRef, AcpRuntimeError>> {
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
      Result<{ meta: AttachmentRef; source: AsyncIterable<Uint8Array> }, AcpRuntimeError>
    > {
      const result = await runtime.downloadAttachment(input.id);
      if (!result.success) return result;
      return ok({
        meta: result.data.ref,
        source: singleChunk(result.data.data),
      });
    },
    deleteAttachment(input: { id: string }): Promise<Result<void, AcpRuntimeError>> {
      return runtime.deleteAttachment(input.id);
    },
    getHistory(input: {
      conversationId: string;
      before?: number;
      limit: number;
    }): Result<HistoryPage, AcpRuntimeError> {
      return runtime.getHistory(input.conversationId, input.before, input.limit);
    },
  };
}

async function* singleChunk(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}

export type AcpProcedures = ReturnType<typeof createAcpProcedures>;

function toStartInput(input: StartSessionInput): AcpStartInput {
  return {
    conversationId: input.conversationId,
    projectId: input.projectId,
    taskId: input.taskId,
    providerId: input.providerId,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    sessionId: input.sessionId ?? null,
    model: input.model ?? input.sessionConfig?.model ?? null,
    initialQueue: input.initialQueue,
  };
}
