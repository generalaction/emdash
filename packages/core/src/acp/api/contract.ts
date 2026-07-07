import { resultSchema } from '@emdash/shared';
import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  cancelTurnCommandSchema,
  changeQueuePromptOrderCommandSchema,
  deleteAttachmentCommandSchema,
  deleteQueuedPromptCommandSchema,
  downloadAttachmentCommandSchema,
  downloadAttachmentResponseSchema,
  editQueuedPromptCommandSchema,
  exportAcpTranscriptCommandSchema,
  exportRawAcpLogCommandSchema,
  queuePromptCommandSchema,
  resolvePermissionCommandSchema,
  resumeSessionCommandSchema,
  sendPromptCommandSchema,
  sendPromptResponseSchema,
  setPromptDraftCommandSchema,
  setModeOptionCommandSchema,
  setModelOptionCommandSchema,
  startSessionCommandSchema,
  stopSessionCommandSchema,
  uploadAttachmentCommandSchema,
  uploadAttachmentResponseSchema,
} from './commands';
import { acpRuntimeErrorSchema } from './errors';
import { acpLiveContract } from './live';
import { historyPageInputSchema, historyPageSchema, resumeResultSchema } from './queries';

const voidResult = resultSchema(z.void(), acpRuntimeErrorSchema);
const startResult = resultSchema(z.object({ sessionId: z.string() }), acpRuntimeErrorSchema);
const sendPromptResult = resultSchema(sendPromptResponseSchema, acpRuntimeErrorSchema);
const historyResult = resultSchema(historyPageSchema, acpRuntimeErrorSchema);
const resumeResult = resultSchema(resumeResultSchema, acpRuntimeErrorSchema);
const attachmentUploadResult = resultSchema(uploadAttachmentResponseSchema, acpRuntimeErrorSchema);
const attachmentDownloadResult = resultSchema(
  downloadAttachmentResponseSchema,
  acpRuntimeErrorSchema
);

export const acpContract = {
  startSession: oc.input(startSessionCommandSchema).output(startResult),
  resumeSession: oc.input(resumeSessionCommandSchema).output(resumeResult),
  stopSession: oc.input(stopSessionCommandSchema).output(voidResult),
  sendPrompt: oc.input(sendPromptCommandSchema).output(sendPromptResult),
  queuePrompt: oc.input(queuePromptCommandSchema).output(sendPromptResult),
  editQueuedPrompt: oc.input(editQueuedPromptCommandSchema).output(voidResult),
  deleteQueuedPrompt: oc.input(deleteQueuedPromptCommandSchema).output(voidResult),
  changeQueuePromptOrder: oc.input(changeQueuePromptOrderCommandSchema).output(voidResult),
  cancelTurn: oc.input(cancelTurnCommandSchema).output(voidResult),
  setModelOption: oc.input(setModelOptionCommandSchema).output(voidResult),
  setModeOption: oc.input(setModeOptionCommandSchema).output(voidResult),
  resolvePermission: oc.input(resolvePermissionCommandSchema).output(voidResult),
  setPromptDraft: oc.input(setPromptDraftCommandSchema).output(voidResult),
  exportACPTranscript: oc
    .input(exportAcpTranscriptCommandSchema)
    .output(resultSchema(z.string(), acpRuntimeErrorSchema)),
  exportRawAcpLog: oc
    .input(exportRawAcpLogCommandSchema)
    .output(resultSchema(z.string(), acpRuntimeErrorSchema)),
  uploadAttachment: oc.input(uploadAttachmentCommandSchema).output(attachmentUploadResult),
  downloadAttachment: oc.input(downloadAttachmentCommandSchema).output(attachmentDownloadResult),
  deleteAttachment: oc.input(deleteAttachmentCommandSchema).output(voidResult),
  getHistory: oc.input(historyPageInputSchema).output(historyResult),
  live: acpLiveContract,
};

export type AcpContract = typeof acpContract;
