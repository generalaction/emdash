import { z } from 'zod';
import { createLiveLogContract, createLiveModelContract } from '../../live';
import { agentStateSchema } from '../models/agents';
import { sessionConfigStateSchema } from '../models/config';
import { planStateSchema } from '../models/plan';
import { promptDraftSchema } from '../models/prompt';
import { sessionStateSchema, sessionSummarySchema } from '../models/session';
import { terminalStateSchema } from '../models/terminals';
import { transcriptTurnSchema } from '../models/turns';

const conversationInput = z.object({ conversationId: z.string() });
const terminalInput = z.object({ terminalId: z.string() });

export const acpLiveContract = {
  sessionStateList: createLiveModelContract(z.record(z.string(), sessionSummarySchema)),
  sessionState: createLiveModelContract(sessionStateSchema, {
    snapshotInput: conversationInput,
    subscribeInput: conversationInput,
    unsubscribeInput: conversationInput,
  }),
  sessionConfig: createLiveModelContract(sessionConfigStateSchema, {
    snapshotInput: conversationInput,
    subscribeInput: conversationInput,
    unsubscribeInput: conversationInput,
  }),
  plan: createLiveModelContract(planStateSchema.nullable(), {
    snapshotInput: conversationInput,
    subscribeInput: conversationInput,
    unsubscribeInput: conversationInput,
  }),
  agents: createLiveModelContract(z.array(agentStateSchema), {
    snapshotInput: conversationInput,
    subscribeInput: conversationInput,
    unsubscribeInput: conversationInput,
  }),
  activeTurn: createLiveModelContract(transcriptTurnSchema.nullable(), {
    snapshotInput: conversationInput,
    subscribeInput: conversationInput,
    unsubscribeInput: conversationInput,
  }),
  promptDraft: createLiveModelContract(promptDraftSchema.nullable(), {
    snapshotInput: conversationInput,
    subscribeInput: conversationInput,
    unsubscribeInput: conversationInput,
  }),
  terminals: createLiveModelContract(z.array(terminalStateSchema), {
    snapshotInput: conversationInput,
    subscribeInput: conversationInput,
    unsubscribeInput: conversationInput,
  }),
  terminalOutput: createLiveLogContract({
    snapshotInput: terminalInput,
    subscribeInput: terminalInput,
    unsubscribeInput: terminalInput,
  }),
};
