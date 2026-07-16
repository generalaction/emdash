import {
  defineContract,
  downloadFile,
  fallible,
  liveLog,
  liveModel,
  liveState,
  uploadFile,
} from '@emdash/wire';
import { z } from 'zod';
import { terminalStateSchema } from '../models';
import { agentStateSchema } from '../models/agents';
import { attachmentMimeTypeSchema, attachmentRefSchema } from '../models/attachments';
import { sessionConfigStateSchema, sessionUsageSchema } from '../models/config';
import { planStateSchema } from '../models/plan';
import { promptDraftSchema, promptDraftStateSchema } from '../models/prompt';
import { sessionStateSchema, sessionSummarySchema } from '../models/session';
import { transcriptTurnSchema } from '../models/turns';
import {
  cancelTurnCommandSchema,
  changeQueuePromptOrderCommandSchema,
  compareAndSetPromptDraftCommandSchema,
  deleteAttachmentCommandSchema,
  deleteQueuedPromptCommandSchema,
  downloadAttachmentCommandSchema,
  editQueuedPromptCommandSchema,
  exportAcpTranscriptCommandSchema,
  exportRawAcpLogCommandSchema,
  queuePromptCommandSchema,
  resolvePermissionCommandSchema,
  resumeSessionCommandSchema,
  sendPromptCommandSchema,
  sendPromptResponseSchema,
  setModeOptionCommandSchema,
  setModelOptionCommandSchema,
  setPromptDraftCommandSchema,
  startSessionCommandSchema,
  stopSessionCommandSchema,
  uploadAttachmentCommandSchema,
  uploadAttachmentResponseSchema,
} from './commands';
import {
  acpAttachmentErrorSchema,
  acpCancelTurnErrorSchema,
  acpChangeQueuePromptOrderErrorSchema,
  acpCompareAndSetPromptDraftErrorSchema,
  acpDeleteQueuedPromptErrorSchema,
  acpEditQueuedPromptErrorSchema,
  acpExportRawLogErrorSchema,
  acpExportTranscriptErrorSchema,
  acpGetHistoryErrorSchema,
  acpGetPromptDraftStateErrorSchema,
  acpQueuePromptErrorSchema,
  acpResolvePermissionErrorSchema,
  acpResumeSessionErrorSchema,
  acpSendPromptErrorSchema,
  acpSetModeOptionErrorSchema,
  acpSetModelOptionErrorSchema,
  acpSetPromptDraftErrorSchema,
  acpStartSessionErrorSchema,
  acpStopSessionErrorSchema,
} from './errors';
import {
  getPromptDraftStateInputSchema,
  historyPageInputSchema,
  historyPageSchema,
  resumeResultSchema,
} from './queries';

const startSessionResultSchema = z.object({ sessionId: z.string() });
const sessionKeySchema = z.object({ conversationId: z.string() });
const terminalOutputKeySchema = z.object({ terminalId: z.string() });

export const acpApiContract = defineContract({
  startSession: fallible({
    input: startSessionCommandSchema,
    data: startSessionResultSchema,
    error: acpStartSessionErrorSchema,
  }),
  resumeSession: fallible({
    input: resumeSessionCommandSchema,
    data: resumeResultSchema,
    error: acpResumeSessionErrorSchema,
  }),
  stopSession: fallible({
    input: stopSessionCommandSchema,
    data: z.void(),
    error: acpStopSessionErrorSchema,
  }),
  sendPrompt: fallible({
    input: sendPromptCommandSchema,
    data: sendPromptResponseSchema,
    error: acpSendPromptErrorSchema,
  }),
  queuePrompt: fallible({
    input: queuePromptCommandSchema,
    data: sendPromptResponseSchema,
    error: acpQueuePromptErrorSchema,
  }),
  editQueuedPrompt: fallible({
    input: editQueuedPromptCommandSchema,
    data: z.void(),
    error: acpEditQueuedPromptErrorSchema,
  }),
  deleteQueuedPrompt: fallible({
    input: deleteQueuedPromptCommandSchema,
    data: z.void(),
    error: acpDeleteQueuedPromptErrorSchema,
  }),
  changeQueuePromptOrder: fallible({
    input: changeQueuePromptOrderCommandSchema,
    data: z.void(),
    error: acpChangeQueuePromptOrderErrorSchema,
  }),
  cancelTurn: fallible({
    input: cancelTurnCommandSchema,
    data: z.void(),
    error: acpCancelTurnErrorSchema,
  }),
  setModelOption: fallible({
    input: setModelOptionCommandSchema,
    data: z.void(),
    error: acpSetModelOptionErrorSchema,
  }),
  setModeOption: fallible({
    input: setModeOptionCommandSchema,
    data: z.void(),
    error: acpSetModeOptionErrorSchema,
  }),
  resolvePermission: fallible({
    input: resolvePermissionCommandSchema,
    data: z.void(),
    error: acpResolvePermissionErrorSchema,
  }),
  setPromptDraft: fallible({
    input: setPromptDraftCommandSchema,
    data: z.void(),
    error: acpSetPromptDraftErrorSchema,
  }),
  compareAndSetPromptDraft: fallible({
    input: compareAndSetPromptDraftCommandSchema,
    data: promptDraftStateSchema,
    error: acpCompareAndSetPromptDraftErrorSchema,
  }),
  getPromptDraftState: fallible({
    input: getPromptDraftStateInputSchema,
    data: promptDraftStateSchema,
    error: acpGetPromptDraftStateErrorSchema,
  }),
  exportACPTranscript: fallible({
    input: exportAcpTranscriptCommandSchema,
    data: z.string(),
    error: acpExportTranscriptErrorSchema,
  }),
  exportRawAcpLog: fallible({
    input: exportRawAcpLogCommandSchema,
    data: z.string(),
    error: acpExportRawLogErrorSchema,
  }),
  uploadAttachment: uploadFile({
    input: uploadAttachmentCommandSchema,
    accept: attachmentMimeTypeSchema.options,
    result: uploadAttachmentResponseSchema,
    error: acpAttachmentErrorSchema,
  }),
  downloadAttachment: downloadFile({
    input: downloadAttachmentCommandSchema,
    meta: attachmentRefSchema,
    error: acpAttachmentErrorSchema,
  }),
  deleteAttachment: fallible({
    input: deleteAttachmentCommandSchema,
    data: z.void(),
    error: acpAttachmentErrorSchema,
  }),
  getHistory: fallible({
    input: historyPageInputSchema,
    data: historyPageSchema,
    error: acpGetHistoryErrorSchema,
  }),
  sessions: liveModel({
    key: z.void(),
    states: {
      list: liveState({ data: z.record(z.string(), sessionSummarySchema) }),
    },
  }),
  session: liveModel({
    key: sessionKeySchema,
    states: {
      state: liveState({ data: sessionStateSchema }),
      config: liveState({ data: sessionConfigStateSchema }),
      usage: liveState({ data: sessionUsageSchema.nullable() }),
      plan: liveState({ data: planStateSchema.nullable() }),
      agents: liveState({ data: z.array(agentStateSchema) }),
      activeTurn: liveState({ data: transcriptTurnSchema.nullable() }),
      draft: liveState({ data: promptDraftSchema.nullable() }),
      terminals: liveState({ data: z.array(terminalStateSchema) }),
    },
  }),
  terminalOutput: liveLog({ key: terminalOutputKeySchema }),
});

export type AcpApiContract = typeof acpApiContract;
export type StartSessionInput = z.infer<typeof startSessionCommandSchema>['input'];
