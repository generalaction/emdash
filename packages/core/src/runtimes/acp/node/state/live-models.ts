import {
  assignDraft,
  cell,
  expose,
  peek,
  produce,
  LiveState,
  type Cell,
  type LeasedLiveModelProvider,
  type LiveStateProduceOptions,
} from '@emdash/wire';
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
} from '@runtimes/acp/api';

type CompatCell<T> = Cell<T> & {
  replace(next: T): void;
  produce(mutator: (draft: T) => void): void;
  snapshot(): { data: T };
  subscribe: LiveState<T>['subscribe'];
  dispose(): void;
};

export type SessionLiveModels = {
  states: {
    state: CompatCell<SessionState>;
    config: CompatCell<SessionConfigState>;
    usage: CompatCell<SessionUsage | null>;
    plan: CompatCell<PlanState | null>;
    agents: CompatCell<AgentState[]>;
    activeTurn: CompatCell<TranscriptTurn | null>;
    draft: CompatCell<PromptDraft | null>;
    terminals: CompatCell<TerminalState[]>;
    mcpServers: CompatCell<SessionMcpServer[]>;
  };
} & { dispose(): void };
export type SessionsListModel = {
  states: {
    list: CompatCell<Record<string, SessionSummary>>;
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
  const model = { states: { list: compatCell<Record<string, SessionSummary>>({}) } };
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
      state: compatCell(initialState),
      config: compatCell(initialSessionConfigState),
      usage: compatCell<SessionUsage | null>(null),
      plan: compatCell<PlanState | null>(null),
      agents: compatCell<AgentState[]>([]),
      activeTurn: compatCell<TranscriptTurn | null>(null),
      draft: compatCell<PromptDraft | null>(null),
      terminals: compatCell<TerminalState[]>([]),
      mcpServers: compatCell<SessionMcpServer[]>([]),
    },
    dispose() {
      host.models.delete(conversationId);
      for (const state of Object.values(this.states)) state.dispose();
    },
  };
  host.models.set(conversationId, model);
  return model;
}

export function createSessionsListModel(host: AcpSessionsLiveHost): SessionsListModel {
  return host.model;
}

export function publishLiveModelState<T>(
  model: CompatCell<T>,
  next: T,
  previous: T | undefined
): void {
  if (Object.is(previous, next)) return;
  model.produce((draft) => assignDraft(draft, next) as never);
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

function compatCell<T>(initial: T): CompatCell<T> {
  const state = cell(initial) as CompatCell<T>;
  const liveState = new LiveState(initial);
  const set = state.set.bind(state);
  state.set = (next, options) => {
    const revision = set(next, options);
    liveState.replace(next, {
      mutationIds: options?.mutationIds ? [...options.mutationIds] : undefined,
    } satisfies LiveStateProduceOptions);
    return revision;
  };
  state.replace = (next) => {
    state.set(next);
  };
  state.produce = (mutator) => {
    const next = produce(peek(state), mutator);
    set(next);
    liveState.produce(mutator);
  };
  state.snapshot = () => liveState.snapshot();
  state.subscribe = (cb) => liveState.subscribe(cb);
  state.dispose = () => liveState.dispose();
  return state;
}

function requireSessionModel(
  models: Map<string, SessionLiveModels>,
  conversationId: string
): SessionLiveModels {
  const model = models.get(conversationId);
  if (!model) throw new Error(`ACP session live model is not registered: ${conversationId}`);
  return model;
}
