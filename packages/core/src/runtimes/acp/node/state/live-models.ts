import { type LeasedLiveModelProvider } from '@emdash/wire/rpc';
import {
  cell,
  derived,
  expose,
  family,
  snapshot,
  type Cell,
  type Family,
  type Readable,
} from '@emdash/wire/state';
import {
  acpApiContract,
  initialSessionConfigState,
  type AgentState,
  type PlanState,
  type SessionConfigState,
  type SessionMcpServer,
  type SessionState,
  type SessionSummary,
  type SessionUsage,
  type TerminalState,
  type TranscriptTurn,
} from '#runtimes/acp/api';

export const inactiveSessionState: SessionState = {
  lifecycle: 'closed',
  activeTurnId: null,
  pendingPermissions: [],
  lastStopReason: null,
  lastTurnErrored: false,
  queuedPrompts: [],
  agentTurnActive: false,
  backgroundAgentCount: 0,
  isGenerating: false,
  canSubmit: false,
  canCancel: false,
};

const EMPTY_AGENTS: AgentState[] = [];
const EMPTY_TERMINALS: TerminalState[] = [];
const EMPTY_MCP_SERVERS: SessionMcpServer[] = [];
Object.freeze(EMPTY_AGENTS);
Object.freeze(EMPTY_TERMINALS);
Object.freeze(EMPTY_MCP_SERVERS);

export type ActivationSnapshot = {
  activationId: string;
  state: SessionState;
  config: SessionConfigState;
  usage: SessionUsage | null;
  plan: PlanState | null;
  agents: readonly AgentState[];
  activeTurn: TranscriptTurn | null;
  terminals: readonly TerminalState[];
  mcpServers: readonly SessionMcpServer[];
};

export type SessionLiveModels = {
  source: Cell<ActivationSnapshot | null>;
  states: {
    activationId: Readable<string | null | undefined>;
    state: Readable<SessionState | undefined>;
    config: Readable<SessionConfigState | undefined>;
    usage: Readable<SessionUsage | null | undefined>;
    plan: Readable<PlanState | null | undefined>;
    agents: Readable<AgentState[] | undefined>;
    activeTurn: Readable<TranscriptTurn | null | undefined>;
    terminals: Readable<TerminalState[] | undefined>;
    mcpServers: Readable<SessionMcpServer[] | undefined>;
  };
};
export type SessionsListModel = {
  states: {
    list: Cell<Record<string, SessionSummary>>;
  };
};
export type AcpSessionLiveHost = LeasedLiveModelProvider<typeof acpApiContract.session> & {
  models: Family<string, SessionLiveModels>;
};
export type AcpSessionsLiveHost = LeasedLiveModelProvider<typeof acpApiContract.sessions> & {
  model: SessionsListModel;
  get(key: unknown): SessionsListModel | undefined;
};

export function createAcpSessionLiveHost(): AcpSessionLiveHost {
  const models = family<string, SessionLiveModels>(() => createProjection(), {
    key: (conversationId) => conversationId,
    name: 'acp-session-projections',
  });
  const provider = expose(
    acpApiContract.session,
    {
      activationId: (key) => models(key.conversationId).states.activationId,
      state: (key) => models(key.conversationId).states.state,
      config: (key) => models(key.conversationId).states.config,
      usage: (key) => models(key.conversationId).states.usage,
      plan: (key) => models(key.conversationId).states.plan,
      agents: (key) => models(key.conversationId).states.agents,
      activeTurn: (key) => models(key.conversationId).states.activeTurn,
      terminals: (key) => models(key.conversationId).states.terminals,
      mcpServers: (key) => models(key.conversationId).states.mcpServers,
    },
    { publish: 'diff' }
  );
  return {
    ...provider,
    models,
    async dispose() {
      await provider.dispose();
      await models.dispose();
    },
  };
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

export function createSessionsListModel(host: AcpSessionsLiveHost): SessionsListModel {
  return host.model;
}

export type {
  AgentState,
  PlanState,
  SessionConfigState,
  SessionMcpServer,
  SessionState,
  SessionSummary,
  SessionUsage,
  TerminalState,
  TranscriptTurn,
};

function createProjection(): SessionLiveModels {
  const source = cell<ActivationSnapshot | null>(null, { name: 'acp-activation' });
  const slice = <T>(read: (current: ActivationSnapshot) => T, inactive: T, name: string) =>
    derived(
      () => {
        const current = snapshot(source).value;
        return current ? read(current) : inactive;
      },
      { name }
    );

  return {
    source,
    states: {
      activationId: slice((current) => current.activationId, null, 'acp-activation-id'),
      state: slice((current) => current.state, inactiveSessionState, 'acp-session-state'),
      config: slice((current) => current.config, initialSessionConfigState, 'acp-session-config'),
      usage: slice((current) => current.usage, null, 'acp-session-usage'),
      plan: slice((current) => current.plan, null, 'acp-session-plan'),
      agents: slice((current) => asMutable(current.agents), EMPTY_AGENTS, 'acp-session-agents'),
      activeTurn: slice((current) => current.activeTurn, null, 'acp-session-active-turn'),
      terminals: slice(
        (current) => asMutable(current.terminals),
        EMPTY_TERMINALS,
        'acp-session-terminals'
      ),
      mcpServers: slice(
        (current) => asMutable(current.mcpServers),
        EMPTY_MCP_SERVERS,
        'acp-session-mcp-servers'
      ),
    },
  };
}

function asMutable<T>(value: readonly T[]): T[] {
  return value as T[];
}
