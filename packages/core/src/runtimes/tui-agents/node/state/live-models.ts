import { type LeasedLiveModelProvider } from '@emdash/wire/rpc';
import { cell, expose, peek, produce, type Cell } from '@emdash/wire/state';
import {
  tuiAgentsContract,
  type TuiAgentStateList,
  type TuiSessionList,
} from '@runtimes/tui-agents/api';

export type TuiSessionsListModel = { states: { list: Cell<TuiSessionList> } };
export type TuiAgentStatesListModel = { states: { list: Cell<TuiAgentStateList> } };
export type TuiSessionsLiveHost = LeasedLiveModelProvider<typeof tuiAgentsContract.sessions> & {
  model: TuiSessionsListModel;
  get(key: unknown): TuiSessionsListModel | undefined;
};
export type TuiAgentStatesLiveHost = LeasedLiveModelProvider<
  typeof tuiAgentsContract.agentStates
> & {
  model: TuiAgentStatesListModel;
  get(key: unknown): TuiAgentStatesListModel | undefined;
};

export function createTuiSessionsLiveHost(): TuiSessionsLiveHost {
  const model = { states: { list: cell({} satisfies TuiSessionList) } };
  return Object.assign(
    expose(tuiAgentsContract.sessions, { list: model.states.list }, { publish: { list: 'diff' } }),
    { model, get: () => model }
  );
}

export function createTuiAgentStatesLiveHost(): TuiAgentStatesLiveHost {
  const model = { states: { list: cell({} satisfies TuiAgentStateList) } };
  return Object.assign(
    expose(
      tuiAgentsContract.agentStates,
      { list: model.states.list },
      { publish: { list: 'diff' } }
    ),
    { model, get: () => model }
  );
}

export function createTuiSessionsListModel(host: TuiSessionsLiveHost): TuiSessionsListModel {
  return host.model;
}

export function createTuiAgentStatesListModel(
  host: TuiAgentStatesLiveHost
): TuiAgentStatesListModel {
  return host.model;
}

export function produceCell<T>(target: Cell<T>, mutator: (draft: T) => void): void {
  target.set(produce(peek(target), mutator));
}
