import { cell, expose, peek, produce, type Cell, type LeasedLiveModelProvider } from '@emdash/wire';
import {
  tuiAgentsContract,
  type TuiAgentStateList,
  type TuiSessionList,
} from '@runtimes/tui-agents/api';

type CompatCell<T> = Cell<T> & {
  replace(next: T): void;
  produce(mutator: (draft: T) => void): void;
  snapshot(): { data: T };
};

export type TuiSessionsListModel = { states: { list: CompatCell<TuiSessionList> } };
export type TuiAgentStatesListModel = { states: { list: CompatCell<TuiAgentStateList> } };
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
  const model = { states: { list: compatCell({} satisfies TuiSessionList) } };
  return Object.assign(
    expose(tuiAgentsContract.sessions, { list: model.states.list }, { publish: { list: 'diff' } }),
    { model, get: () => model }
  );
}

export function createTuiAgentStatesLiveHost(): TuiAgentStatesLiveHost {
  const model = { states: { list: compatCell({} satisfies TuiAgentStateList) } };
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

function compatCell<T>(initial: T): CompatCell<T> {
  const state = cell(initial) as CompatCell<T>;
  state.replace = (next) => {
    state.set(next);
  };
  state.produce = (mutator) => {
    state.set(produce(peek(state), mutator));
  };
  state.snapshot = () => ({ data: peek(state) });
  return state;
}
