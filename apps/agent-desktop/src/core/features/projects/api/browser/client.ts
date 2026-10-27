import type { ContractClient } from '@agent/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { projectsDomain, projectsWireContract } from '../wire-contract';

export type ProjectsWireClient = ContractClient<typeof projectsWireContract>;

export function getProjectsWireClient(): Promise<ProjectsWireClient> {
  return domainClient<ProjectsWireClient>(projectsDomain, projectsWireContract);
}
