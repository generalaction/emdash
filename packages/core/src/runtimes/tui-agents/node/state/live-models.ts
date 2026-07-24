import { createLiveModelHost, type LiveInstance, type LiveModelHost } from '@emdash/wire';
import {
  tuiAgentsContract,
  type TuiAgentStateList,
  type TuiSessionList,
} from '@runtimes/tui-agents/api';

export type TuiSessionsLiveHost = LiveModelHost<typeof tuiAgentsContract.sessions>;
export type TuiAgentStatesLiveHost = LiveModelHost<typeof tuiAgentsContract.agentStates>;
export type TuiSessionsListModel = LiveInstance<typeof tuiAgentsContract.sessions>;
export type TuiAgentStatesListModel = LiveInstance<typeof tuiAgentsContract.agentStates>;

export function createTuiSessionsLiveHost(): TuiSessionsLiveHost {
  return createLiveModelHost(tuiAgentsContract.sessions);
}

export function createTuiAgentStatesLiveHost(): TuiAgentStatesLiveHost {
  return createLiveModelHost(tuiAgentsContract.agentStates);
}

export function createTuiSessionsListModel(host: TuiSessionsLiveHost): TuiSessionsListModel {
  return host.create(undefined, { list: {} satisfies TuiSessionList });
}

export function createTuiAgentStatesListModel(
  host: TuiAgentStatesLiveHost
): TuiAgentStatesListModel {
  return host.create(undefined, { list: {} satisfies TuiAgentStateList });
}
