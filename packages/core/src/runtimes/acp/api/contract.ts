import { defineContract, fallible, liveLog, liveModel, liveState } from '@emdash/wire/rpc';
import { z } from 'zod';
import { terminalStateSchema } from '#runtimes/acp/api/models';
import { agentStateSchema } from '#runtimes/acp/api/models/agents';
import {
  sessionConfigStateSchema,
  sessionMcpServerSchema,
  sessionUsageSchema,
} from '#runtimes/acp/api/models/config';
import { planStateSchema } from '#runtimes/acp/api/models/plan';
import { sessionStateSchema, sessionSummarySchema } from '#runtimes/acp/api/models/session';
import { transcriptTurnSchema } from '#runtimes/acp/api/models/turns';
import {
  acpCancelTurnErrorSchema,
  acpChangeQueuePromptOrderErrorSchema,
  acpDeleteQueuedPromptErrorSchema,
  acpEditQueuedPromptErrorSchema,
  acpExportRawLogErrorSchema,
  acpExportTranscriptErrorSchema,
  acpLaunchErrorSchema,
  acpLoadHistoryErrorSchema,
  acpResolvePermissionErrorSchema,
  acpSendPromptErrorSchema,
  acpSetOptionErrorSchema,
  acpStartErrorSchema,
  acpTerminateErrorSchema,
} from './errors';
import {
  acpStartInputSchema,
  acpSessionStartModeSchema,
  cancelTurnCommandSchema,
  changeQueuePromptOrderCommandSchema,
  deleteQueuedPromptCommandSchema,
  editQueuedPromptCommandSchema,
  exportAcpTranscriptCommandSchema,
  exportRawAcpLogCommandSchema,
  historyPageInputSchema,
  loadHistoryResultSchema,
  resolvePermissionCommandSchema,
  sendPromptCommandSchema,
  sendPromptResponseSchema,
  setOptionCommandSchema,
  terminateCommandSchema,
} from './schemas';

const startSessionResultSchema = z.object({
  sessionId: z.string(),
  clearedConfiguration: z
    .array(z.enum(['model', 'modeId', 'effort', 'collaborationMode']))
    .optional(),
});
const sessionKeySchema = z.object({ conversationId: z.string() });
const terminalOutputKeySchema = z.object({ terminalId: z.string() });

export const acpApiContract = defineContract({
  attach: fallible({
    input: acpStartInputSchema,
    data: z.object({ sessionId: z.string().nullable() }),
    error: acpStartErrorSchema,
  }),
  startSession: fallible({
    input: acpStartInputSchema.extend({ mode: acpSessionStartModeSchema }),
    data: startSessionResultSchema,
    error: acpLaunchErrorSchema,
  }),
  /**
   * Terminates any active process and removes the persisted active intent — the session no
   * longer auto-resumes across daemon restarts. The conversation record stays resumable
   * manually.
   */
  terminate: fallible({
    input: terminateCommandSchema,
    error: acpTerminateErrorSchema,
  }),
  sendPrompt: fallible({
    input: sendPromptCommandSchema,
    data: sendPromptResponseSchema,
    error: acpSendPromptErrorSchema,
  }),
  editQueuedPrompt: fallible({
    input: editQueuedPromptCommandSchema,
    error: acpEditQueuedPromptErrorSchema,
  }),
  deleteQueuedPrompt: fallible({
    input: deleteQueuedPromptCommandSchema,
    error: acpDeleteQueuedPromptErrorSchema,
  }),
  changeQueuePromptOrder: fallible({
    input: changeQueuePromptOrderCommandSchema,
    error: acpChangeQueuePromptOrderErrorSchema,
  }),
  cancelTurn: fallible({
    input: cancelTurnCommandSchema,
    error: acpCancelTurnErrorSchema,
  }),
  setOption: fallible({
    input: setOptionCommandSchema,
    error: acpSetOptionErrorSchema,
  }),
  resolvePermission: fallible({
    input: resolvePermissionCommandSchema,
    error: acpResolvePermissionErrorSchema,
  }),
  exportAcpTranscript: fallible({
    input: exportAcpTranscriptCommandSchema,
    data: z.object({ transcript: z.string() }),
    error: acpExportTranscriptErrorSchema,
  }),
  exportRawAcpLog: fallible({
    input: exportRawAcpLogCommandSchema,
    data: z.object({ log: z.string() }),
    error: acpExportRawLogErrorSchema,
  }),

  loadHistory: fallible({
    input: historyPageInputSchema,
    data: loadHistoryResultSchema,
    error: acpLoadHistoryErrorSchema,
  }),
  sessions: liveModel({
    key: z.void().optional(),
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
      terminals: liveState({ data: z.array(terminalStateSchema) }),
      mcpServers: liveState({ data: z.array(sessionMcpServerSchema) }),
    },
  }),
  terminalOutput: liveLog({ key: terminalOutputKeySchema }),
});

export type AcpApiContract = typeof acpApiContract;
