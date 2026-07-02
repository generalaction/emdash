import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { createLiveModelContract } from '../../live-model/schema';
import { result } from '../shared/schemas';
import {
  acpPromptImageSchema,
  acpRuntimeErrorSchema,
  acpStartInputSchema,
  activeTurnEntrySchema,
  historyPageSchema,
  resumeResultSchema,
  sessionConfigStateSchema,
  sessionStateListSchema,
  terminalOutputEventSchema,
} from './schemas';

const acpResult = result(z.void(), acpRuntimeErrorSchema);
const acpResultSessionId = result(z.object({ sessionId: z.string() }), acpRuntimeErrorSchema);
const acpResultHistoryPage = result(historyPageSchema, acpRuntimeErrorSchema);
const acpResultResumeResult = result(resumeResultSchema, acpRuntimeErrorSchema);

export const acpContract = {
  startSession: oc.input(z.object({ input: acpStartInputSchema })).output(acpResultSessionId),
  resumeSession: oc
    .input(
      z.object({
        conversationId: z.string(),
        providerId: z.string(),
        cwd: z.string(),
        sessionId: z.string(),
      })
    )
    .output(acpResultResumeResult),
  stopSession: oc.input(z.object({ conversationId: z.string() })).output(acpResult),
  sendPrompt: oc
    .input(
      z.object({
        conversationId: z.string(),
        text: z.string(),
        images: z.array(acpPromptImageSchema).optional(),
      })
    )
    .output(acpResult),
  cancelTurn: oc.input(z.object({ conversationId: z.string() })).output(acpResult),
  setModelOption: oc
    .input(
      z.object({
        conversationId: z.string(),
        dimension: z.enum(['model', 'effort']),
        value: z.string(),
      })
    )
    .output(acpResult),
  setModeOption: oc
    .input(z.object({ conversationId: z.string(), value: z.string() }))
    .output(acpResult),
  resolvePermission: oc
    .input(
      z.object({
        conversationId: z.string(),
        requestId: z.string(),
        optionId: z.string().nullable(),
      })
    )
    .output(acpResult),
  killAllTerminals: oc.input(z.void().optional()).output(z.void()),
  getHistory: oc
    .input(
      z.object({
        conversationId: z.string(),
        before: z.number().int().optional(),
        limit: z.number().int(),
      })
    )
    .output(acpResultHistoryPage),
  subscribeActiveTurn: oc
    .input(z.object({ conversationId: z.string(), seq: z.number().int() }))
    .output(eventIterator(activeTurnEntrySchema)),
  subscribeTerminalOutput: oc
    .input(z.object({ id: z.string(), offset: z.number().int().optional() }))
    .output(eventIterator(terminalOutputEventSchema)),
  sessionConfig: createLiveModelContract(
    sessionConfigStateSchema,
    { snapshotInput: z.object({ conversationId: z.string() }) }
  ),
  sessionStateList: createLiveModelContract(sessionStateListSchema),
};

export type AcpContract = typeof acpContract;
