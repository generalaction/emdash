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

export const closedSessionState: SessionState = {
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

export const suspendedSessionState: SessionState = {
  ...closedSessionState,
  suspended: true,
  canSubmit: true,
};

const EMPTY_AGENTS: AgentState[] = [];
const EMPTY_TERMINALS: TerminalState[] = [];
const EMPTY_MCP_SERVERS: SessionMcpServer[] = [];
Object.freeze(EMPTY_AGENTS);
Object.freeze(EMPTY_TERMINALS);
Object.freeze(EMPTY_MCP_SERVERS);

export type ActivationSnapshot = {
  state: SessionState;
  config: SessionConfigState;
  usage: SessionUsage | null;
  plan: PlanState | null;
  agents: readonly AgentState[];
  activeTurn: TranscriptTurn | null;
  terminals: readonly TerminalState[];
  mcpServers: readonly SessionMcpServer[];
};

export type RetainedConfiguredState = {
  model: string | null;
  modeId: string | null;
  effort: string | null;
};

export type RetainedPresentation = {
  configured: RetainedConfiguredState;
  lastKnownCapabilities: SessionConfigState;
  lastKnownMcpServers: readonly SessionMcpServer[];
  lastKnownUsage: SessionUsage | null;
  observedAt: number | null;
};

export type SessionProjectionSource =
  | { kind: 'closed' }
  | { kind: 'suspended'; retained?: RetainedPresentation }
  | { kind: 'active'; snapshot: ActivationSnapshot };

export type SessionLiveModels = {
  source: Cell<SessionProjectionSource>;
  states: {
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
};

export function createAcpSessionLiveHost(): AcpSessionLiveHost {
  const models = family<string, SessionLiveModels>(() => createProjection(), {
    key: (conversationId) => conversationId,
    name: 'acp-session-projections',
  });
  const provider = expose(
    acpApiContract.session,
    {
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
    { model }
  );
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
  const source = cell<SessionProjectionSource>({ kind: 'closed' }, { name: 'acp-session-source' });
  const retainedSlice = <T>(
    readActive: (current: ActivationSnapshot) => T,
    readRetained: (retained: RetainedPresentation) => T,
    inactive: T,
    name: string
  ) =>
    derived(
      () => {
        const current = snapshot(source).value;
        if (current.kind === 'active') return readActive(current.snapshot);
        if (current.kind === 'suspended' && current.retained) {
          return readRetained(current.retained);
        }
        return inactive;
      },
      { name }
    );

  return {
    source,
    states: {
      state: derived(
        () => {
          const current = snapshot(source).value;
          if (current.kind === 'active') return current.snapshot.state;
          return current.kind === 'suspended' ? suspendedSessionState : closedSessionState;
        },
        { name: 'acp-session-state' }
      ),
      config: retainedSlice(
        (current) => current.config,
        retainedConfig,
        initialSessionConfigState,
        'acp-session-config'
      ),
      usage: retainedSlice(
        (current) => current.usage,
        (retained) => retained.lastKnownUsage,
        null,
        'acp-session-usage'
      ),
      plan: retainedSlice(
        (current) => current.plan,
        () => null,
        null,
        'acp-session-plan'
      ),
      agents: retainedSlice(
        (current) => asMutable(current.agents),
        () => EMPTY_AGENTS,
        EMPTY_AGENTS,
        'acp-session-agents'
      ),
      activeTurn: retainedSlice(
        (current) => current.activeTurn,
        () => null,
        null,
        'acp-session-active-turn'
      ),
      terminals: retainedSlice(
        (current) => asMutable(current.terminals),
        () => EMPTY_TERMINALS,
        EMPTY_TERMINALS,
        'acp-session-terminals'
      ),
      mcpServers: retainedSlice(
        (current) => asMutable(current.mcpServers),
        (retained) => asMutable(retained.lastKnownMcpServers),
        EMPTY_MCP_SERVERS,
        'acp-session-mcp-servers'
      ),
    },
  };
}

export function emptyRetainedPresentation(
  configured: RetainedConfiguredState
): RetainedPresentation {
  return {
    configured,
    lastKnownCapabilities: initialSessionConfigState,
    lastKnownMcpServers: EMPTY_MCP_SERVERS,
    lastKnownUsage: null,
    observedAt: null,
  };
}

export function retainedConfig(retained: RetainedPresentation): SessionConfigState {
  const { configured, lastKnownCapabilities } = retained;
  return {
    ...lastKnownCapabilities,
    modelOptions: selected(lastKnownCapabilities.modelOptions, configured.model),
    efforts: selected(lastKnownCapabilities.efforts, configured.effort),
    modeOptions: selected(lastKnownCapabilities.modeOptions, configured.modeId),
  };
}

function selected<T extends { selected: string | null }>(
  group: T | null,
  value: string | null
): T | null {
  return group ? { ...group, selected: value ?? group.selected } : null;
}

function asMutable<T>(value: readonly T[]): T[] {
  return value as T[];
}
