import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import {
  runtimeResolveErrorAsError,
  type HostRuntimesClient,
  type RuntimeBroker,
} from '@emdash/core/services/runtime-broker/api';
import type { AutomationRuntimeAvailability } from '@core/primitives/automations/api';
import { projectHostRef, type Project } from '@core/primitives/projects/api';

export type AutomationRuntimeDependencies = {
  runtimes: Pick<RuntimeBroker, 'client'>;
  getProjectById(projectId: string): Promise<Project | undefined>;
};

const ADOPTION_UNAVAILABLE_REASON = 'Run adoption is not yet supported for remote projects.';

export async function resolveAutomationRuntimeClient(
  dependencies: AutomationRuntimeDependencies,
  projectId?: string | null
): Promise<HostRuntimesClient> {
  let host = LOCAL_HOST_REF;
  if (projectId) {
    const project = await dependencies.getProjectById(projectId);
    if (!project) throw new Error(`Runtime project '${projectId}' was not found`);
    host = projectHostRef(project);
  }

  const result = await dependencies.runtimes.client(host);
  if (!result.success) throw runtimeResolveErrorAsError(result.error);
  return result.data;
}

export async function getAutomationRuntimeAvailability(
  dependencies: AutomationRuntimeDependencies,
  projectId: string | undefined
): Promise<AutomationRuntimeAvailability> {
  if (!projectId) {
    return { available: false, reason: 'Assign a project before configuring this automation.' };
  }
  const project = await dependencies.getProjectById(projectId);
  if (!project) {
    return { available: false, reason: 'The automation project no longer exists.' };
  }
  if (project.type === 'ssh') {
    return { available: false, reason: ADOPTION_UNAVAILABLE_REASON };
  }
  return { available: true };
}
