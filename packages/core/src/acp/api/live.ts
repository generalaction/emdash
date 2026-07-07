import { z } from 'zod';
import type { LiveLogSnapshotData, LiveSource } from '../../live';
import { createLiveLogContract, createLiveModelContract } from '../../live';
import { defineLiveTopic, type LiveResolver, WireError } from '../../wire';
import { agentStateSchema } from '../models/agents';
import type { AgentState } from '../models/agents';
import {
  sessionConfigStateSchema,
  sessionUsageSchema,
  type SessionConfigState,
  type SessionUsage,
} from '../models/config';
import { planStateSchema, type PlanState } from '../models/plan';
import { promptDraftSchema, type PromptDraft } from '../models/prompt';
import {
  sessionStateSchema,
  sessionSummarySchema,
  type SessionState,
  type SessionSummary,
} from '../models/session';
import { terminalStateSchema, type TerminalState } from '../models/terminals';
import { transcriptTurnSchema, type TranscriptTurn } from '../models/turns';
import type { AcpRuntime } from '../runtime/runtime';
import type { SessionLiveModels } from '../state/live-models';

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
  sessionUsage: createLiveModelContract(sessionUsageSchema.nullable(), {
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

type ConversationInput = { conversationId: string };
type TerminalInput = { terminalId: string };

export const acpLiveTopics = {
  sessionStateList: defineLiveTopic<void | undefined, Record<string, SessionSummary>>(
    'sessionStateList'
  ),
  sessionState: defineLiveTopic<ConversationInput, SessionState>('sessionState', {
    serialize: ({ conversationId }) => conversationId,
  }),
  sessionConfig: defineLiveTopic<ConversationInput, SessionConfigState>('sessionConfig', {
    serialize: ({ conversationId }) => conversationId,
  }),
  sessionUsage: defineLiveTopic<ConversationInput, SessionUsage | null>('sessionUsage', {
    serialize: ({ conversationId }) => conversationId,
  }),
  plan: defineLiveTopic<ConversationInput, PlanState | null>('plan', {
    serialize: ({ conversationId }) => conversationId,
  }),
  agents: defineLiveTopic<ConversationInput, AgentState[]>('agents', {
    serialize: ({ conversationId }) => conversationId,
  }),
  activeTurn: defineLiveTopic<ConversationInput, TranscriptTurn | null>('activeTurn', {
    serialize: ({ conversationId }) => conversationId,
  }),
  promptDraft: defineLiveTopic<ConversationInput, PromptDraft | null>('promptDraft', {
    serialize: ({ conversationId }) => conversationId,
  }),
  terminals: defineLiveTopic<ConversationInput, TerminalState[]>('terminals', {
    serialize: ({ conversationId }) => conversationId,
  }),
  terminalOutput: defineLiveTopic<TerminalInput, LiveLogSnapshotData>('terminalOutput', {
    serialize: ({ terminalId }) => terminalId,
  }),
};

export type AcpLiveTopics = typeof acpLiveTopics;

export function createAcpLiveResolver(runtime: AcpRuntime): LiveResolver {
  return (topic) => {
    const { name, key } = splitTopic(topic);
    switch (name) {
      case 'sessionStateList':
        return runtime.sessionsListLiveModel();
      case 'sessionState':
        return sessionSource(runtime, key, (models) => models.sessionState);
      case 'sessionConfig':
        return sessionSource(runtime, key, (models) => models.config);
      case 'sessionUsage':
        return sessionSource(runtime, key, (models) => models.usage);
      case 'plan':
        return sessionSource(runtime, key, (models) => models.plan);
      case 'agents':
        return sessionSource(runtime, key, (models) => models.agents);
      case 'activeTurn':
        return sessionSource(runtime, key, (models) => models.activeTurn);
      case 'promptDraft':
        return sessionSource(runtime, key, (models) => models.draft);
      case 'terminals':
        return key ? runtime.terminalsLiveModel(key) : missingLiveSource('Missing conversation id');
      case 'terminalOutput':
        return key
          ? (runtime.terminalOutputLog(key) ?? missingLiveSource(`Unknown terminal '${key}'`))
          : missingLiveSource('Missing terminal id');
      default:
        return null;
    }
  };
}

function sessionSource(
  runtime: AcpRuntime,
  conversationId: string,
  select: (models: SessionLiveModels) => LiveSource
): LiveSource {
  if (!conversationId) return missingLiveSource('Missing conversation id');
  const models = runtime.sessionLiveModels(conversationId);
  if (!models) return missingLiveSource(`Unknown conversation '${conversationId}'`);
  return select(models);
}

function missingLiveSource(message: string): LiveSource {
  return {
    snapshot() {
      throw new WireError('NOT_FOUND', message);
    },
    subscribe() {
      return () => {};
    },
  };
}

function splitTopic(topic: string): { name: string; key: string } {
  const index = topic.indexOf(':');
  if (index === -1) return { name: topic, key: '' };
  return {
    name: topic.slice(0, index),
    key: topic.slice(index + 1),
  };
}
