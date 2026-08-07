import { type LeasedLiveModelProvider } from '@emdash/wire/rpc';
import { cell, expose, peek, type Cell, produce, publishStructural } from '@emdash/wire/state';
import {
  acpApiContract,
  initialSessionConfigState,
  type AgentState,
  type PlanState,
  type PromptDraft,
  type SessionConfigState,
  type SessionMcpServer,
  type SessionState,
  type SessionSummary,
  type SessionUsage,
  type TerminalState,
  type TranscriptTurn,
} from '#runtimes/acp/api';

export type SessionLiveModels = {
  states: {
    state: Cell<SessionState>;
    config: Cell<SessionConfigState>;
    usage: Cell<SessionUsage | null>;
    plan: Cell<PlanState | null>;
    agents: Cell<AgentState[]>;
    activeTurn: Cell<TranscriptTurn | null>;
    draft: Cell<PromptDraft | null>;
    terminals: Cell<TerminalState[]>;
    mcpServers: Cell<SessionMcpServer[]>;
  };
} & { dispose(): void };
export type SessionsListModel = {
  states: {
    list: Cell<Record<string, SessionSummary>>;
  };
};
export type AcpSessionLiveHost = LeasedLiveModelProvider<typeof acpApiContract.session> & {
  models: Map<string, SessionLiveModels>;
};
export type AcpSessionsLiveHost = LeasedLiveModelProvider<typeof acpApiContract.sessions> & {
  model: SessionsListModel;
  get(key: unknown): SessionsListModel | undefined;
};

export function createAcpSessionLiveHost(): AcpSessionLiveHost {
  const models = new Map<string, SessionLiveModels>();
  return Object.assign(
    expose(
      acpApiContract.session,
      {
        state: (key) => requireSessionModel(models, key.conversationId).states.state,
        config: (key) => requireSessionModel(models, key.conversationId).states.config,
        usage: (key) => requireSessionModel(models, key.conversationId).states.usage,
        plan: (key) => requireSessionModel(models, key.conversationId).states.plan,
        agents: (key) => requireSessionModel(models, key.conversationId).states.agents,
        activeTurn: (key) => requireSessionModel(models, key.conversationId).states.activeTurn,
        draft: (key) => requireSessionModel(models, key.conversationId).states.draft,
        terminals: (key) => requireSessionModel(models, key.conversationId).states.terminals,
        mcpServers: (key) => requireSessionModel(models, key.conversationId).states.mcpServers,
      },
      { publish: 'diff' }
    ),
    { models }
  );
}

export function createAcpSessionsLiveHost(): AcpSessionsLiveHost {
  const model = { states: { list: cell<Record<string, SessionSummary>>({}) } };
  return Object.assign(
    expose(
      acpApiContract.sessions,
      {
        list: model.states.list,
      },
      { publish: { list: 'diff' } }
    ),
    { model, get: () => model }
  );
}

export function createSessionLiveModels(
  host: AcpSessionLiveHost,
  conversationId: string,
  initialState: SessionState
): SessionLiveModels {
  const model: SessionLiveModels = {
    states: {
      state: cell(initialState),
      config: cell(initialSessionConfigState),
      usage: cell<SessionUsage | null>(null),
      plan: cell<PlanState | null>(null),
      agents: cell<AgentState[]>([]),
      activeTurn: cell<TranscriptTurn | null>(null),
      draft: cell<PromptDraft | null>(null),
      terminals: cell<TerminalState[]>([]),
      mcpServers: cell<SessionMcpServer[]>([]),
    },
    dispose() {
      host.models.delete(conversationId);
    },
  };
  host.models.set(conversationId, model);
  return model;
}

export function createSessionsListModel(host: AcpSessionsLiveHost): SessionsListModel {
  return host.model;
}

export function publishLiveModelState<T>(model: Cell<T>, next: T, previous: T | undefined): void {
  if (Object.is(previous, next)) return;
  publishStructural(model, next);
}

export function produceCell<T>(target: Cell<T>, mutator: (draft: T) => void): void {
  target.set(produce(peek(target), mutator));
}

export type {
  AgentState,
  PlanState,
  PromptDraft,
  SessionConfigState,
  SessionMcpServer,
  SessionState,
  SessionSummary,
  SessionUsage,
  TerminalState,
  TranscriptTurn,
};

function requireSessionModel(
  models: Map<string, SessionLiveModels>,
  conversationId: string
): SessionLiveModels {
  const model = models.get(conversationId);
  if (!model) throw new Error(`ACP session live model is not registered: ${conversationId}`);
  return model;
}
