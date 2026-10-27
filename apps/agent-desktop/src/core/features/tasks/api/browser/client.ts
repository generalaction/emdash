import type { ContractClient } from '@agent/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { tasksDomain, tasksWireContract } from '../wire-contract';

export type TasksWireClient = ContractClient<typeof tasksWireContract>;

export function getTasksWireClient(): Promise<TasksWireClient> {
  return domainClient<TasksWireClient>(tasksDomain, tasksWireContract);
}
