import { serializedHostRefSchema } from '@emdash/core/primitives/host/api';
import { acpApiContract, sessionSummarySchema } from '@emdash/core/runtimes/acp/api/client';
import { tuiAgentsContract, tuiSessionListSchema } from '@emdash/core/runtimes/tui-agents/api';
import {
  defineContract,
  downloadFile,
  eventStream,
  liveLog,
  liveModel,
  liveState,
  procedure,
  uploadFile,
} from '@emdash/wire/rpc';
import { z } from 'zod';
import type {
  Conversation,
  ConversationEvent,
  CreateConversationParams,
  HostConversationRow,
} from '@core/primitives/conversations/api';
import {
  runtimeFallibleProcedure,
  runtimeResolveErrorUnion,
} from '@core/primitives/desktop-runtime/api/fallible-contract';

const conversationKey = z.object({ conversationId: z.string() });
const conversationLocation = z.object({
  projectId: z.string(),
  taskId: z.string(),
  conversationId: z.string(),
});
const attachmentKey = conversationKey.extend({ attachmentId: z.string() });
const hostSessionsKey = z.object({ host: serializedHostRefSchema });

const desktopAcpSessions = liveModel({
  key: hostSessionsKey,
  states: {
    list: liveState({ data: z.record(z.string(), sessionSummarySchema) }),
  },
});

const desktopTuiSessions = liveModel({
  key: hostSessionsKey,
  states: {
    list: liveState({ data: tuiSessionListSchema }),
  },
});

const conversationsAcpContract = defineContract({
  startSession: runtimeFallibleProcedure(conversationKey, acpApiContract.startSession.output),
  resumeSession: runtimeFallibleProcedure(conversationKey, acpApiContract.resumeSession.output),
  killSession: runtimeFallibleProcedure(
    acpApiContract.killSession.input,
    acpApiContract.killSession.output
  ),
  sendPrompt: runtimeFallibleProcedure(
    acpApiContract.sendPrompt.input,
    acpApiContract.sendPrompt.output
  ),
  editQueuedPrompt: runtimeFallibleProcedure(
    acpApiContract.editQueuedPrompt.input,
    acpApiContract.editQueuedPrompt.output
  ),
  deleteQueuedPrompt: runtimeFallibleProcedure(
    acpApiContract.deleteQueuedPrompt.input,
    acpApiContract.deleteQueuedPrompt.output
  ),
  changeQueuePromptOrder: runtimeFallibleProcedure(
    acpApiContract.changeQueuePromptOrder.input,
    acpApiContract.changeQueuePromptOrder.output
  ),
  cancelTurn: runtimeFallibleProcedure(
    acpApiContract.cancelTurn.input,
    acpApiContract.cancelTurn.output
  ),
  setModelOption: runtimeFallibleProcedure(
    acpApiContract.setModelOption.input,
    acpApiContract.setModelOption.output
  ),
  setModeOption: runtimeFallibleProcedure(
    acpApiContract.setModeOption.input,
    acpApiContract.setModeOption.output
  ),
  resolvePermission: runtimeFallibleProcedure(
    acpApiContract.resolvePermission.input,
    acpApiContract.resolvePermission.output
  ),
  setPromptDraft: runtimeFallibleProcedure(
    acpApiContract.setPromptDraft.input,
    acpApiContract.setPromptDraft.output
  ),
  exportACPTranscript: runtimeFallibleProcedure(
    acpApiContract.exportACPTranscript.input,
    acpApiContract.exportACPTranscript.output
  ),
  exportRawAcpLog: runtimeFallibleProcedure(
    acpApiContract.exportRawAcpLog.input,
    acpApiContract.exportRawAcpLog.output
  ),
  uploadAttachment: uploadFile({
    input: conversationKey.extend({ originalPath: z.string().optional() }),
    accept: acpApiContract.uploadAttachment.accept,
    result: acpApiContract.uploadAttachment.result,
    error: runtimeResolveErrorUnion(acpApiContract.uploadAttachment.error),
  }),
  downloadAttachment: downloadFile({
    input: attachmentKey,
    meta: acpApiContract.downloadAttachment.meta,
    error: runtimeResolveErrorUnion(acpApiContract.downloadAttachment.error),
  }),
  deleteAttachment: runtimeFallibleProcedure(attachmentKey, acpApiContract.deleteAttachment.output),
  getHistory: runtimeFallibleProcedure(
    acpApiContract.getHistory.input,
    acpApiContract.getHistory.output
  ),
  sessions: desktopAcpSessions,
  session: acpApiContract.session,
  terminalOutput: liveLog({
    key: conversationKey.extend({ terminalId: z.string() }),
  }),
});

const conversationsTuiContract = defineContract({
  startSession: runtimeFallibleProcedure(
    tuiAgentsContract.startSession.input,
    tuiAgentsContract.startSession.output
  ),
  resumeSession: runtimeFallibleProcedure(
    tuiAgentsContract.resumeSession.input,
    tuiAgentsContract.resumeSession.output
  ),
  stopSession: runtimeFallibleProcedure(
    tuiAgentsContract.stopSession.input,
    tuiAgentsContract.stopSession.output
  ),
  deleteSession: runtimeFallibleProcedure(
    tuiAgentsContract.deleteSession.input,
    tuiAgentsContract.deleteSession.output
  ),
  killSession: runtimeFallibleProcedure(
    tuiAgentsContract.killSession.input,
    tuiAgentsContract.killSession.output
  ),
  sendInput: runtimeFallibleProcedure(
    tuiAgentsContract.sendInput.input,
    tuiAgentsContract.sendInput.output
  ),
  resize: runtimeFallibleProcedure(tuiAgentsContract.resize.input, tuiAgentsContract.resize.output),
  output: tuiAgentsContract.output,
  sessions: desktopTuiSessions,
});

export const conversationsDomain = 'conversations' as const;

export const conversationsContract = defineContract({
  getConversations: procedure({
    input: z.void(),
    output: z.custom<Conversation[]>(),
  }),
  createConversation: procedure({
    input: z.custom<CreateConversationParams>(),
    output: z.custom<Conversation>(),
  }),
  deleteConversation: procedure({
    input: conversationLocation,
    output: z.void(),
  }),
  hydrateConversation: procedure({
    input: conversationLocation,
    output: z.void(),
  }),
  dehydrateConversation: procedure({
    input: conversationLocation,
    output: z.void(),
  }),
  renameConversation: procedure({
    input: z.object({ conversationId: z.string(), name: z.string() }),
    output: z.void(),
  }),
  getConversationsForTask: procedure({
    input: z.object({ projectId: z.string(), taskId: z.string() }),
    output: z.custom<Conversation[]>(),
  }),
  getConversationsForProject: procedure({
    input: z.object({ projectId: z.string() }),
    output: z.custom<Conversation[]>(),
  }),
  markConversationSeen: procedure({
    input: z.object({ conversationId: z.string() }),
    output: z.void(),
  }),
  // Machine-page surface (spec §8): host-scoped registry reads plus link-free management.
  listHostConversations: procedure({
    input: z.object({
      location: z.enum(['local', 'remote']),
      sshConnectionId: z.string().nullable(),
    }),
    output: z.custom<HostConversationRow[]>(),
  }),
  linkConversationToTask: procedure({
    input: z.object({ conversationId: z.string(), projectId: z.string(), taskId: z.string() }),
    output: z.void(),
  }),
  deleteHostConversation: procedure({
    input: z.object({ conversationId: z.string() }),
    output: z.void(),
  }),
  events: eventStream({ key: z.void(), event: z.custom<ConversationEvent>() }),
  acp: conversationsAcpContract,
  tui: conversationsTuiContract,
});

export type ConversationsContract = typeof conversationsContract;
