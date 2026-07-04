import { z } from 'zod';
import { createLiveModelContract } from '../../live';
import { agentStateSchema } from '../models/agents';
import { sessionConfigStateSchema } from '../models/config';
import { planStateSchema } from '../models/plan';
import { sessionStateSchema, sessionSummarySchema } from '../models/session';
import { transcriptTurnSchema } from '../models/turns';

const conversationInput = z.object({ conversationId: z.string() });

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
};
