import type { AutomationRuntimeAvailability } from '@core/primitives/automations/api';
import type { Project } from '@core/primitives/projects/api';
import type { AutomationsRuntimeClient } from '@core/services/runtime-broker/api/clients';

export type AutomationRuntimeTarget = {
  key: string;
  client: AutomationsRuntimeClient;
};

export type AutomationRuntimeDependencies = {
  getAutomationsRuntimeClient(): Promise<AutomationsRuntimeClient>;
  getProjectById(projectId: string): Promise<Project | undefined>;
};

const REMOTE_UNAVAILABLE_REASON =
  'This desktop build cannot reach the remote automation runtime yet.';

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
    return { available: false, reason: REMOTE_UNAVAILABLE_REASON };
  }
  return { available: true };
}

export async function resolveAutomationRuntime(
  dependencies: AutomationRuntimeDependencies,
  projectId: string | undefined
): Promise<AutomationRuntimeTarget> {
  const availability = await getAutomationRuntimeAvailability(dependencies, projectId);
  if (!availability.available) throw new Error(availability.reason);

  return resolveLocalAutomationRuntime(dependencies);
}

export async function resolveLocalAutomationRuntime(
  dependencies: AutomationRuntimeDependencies
): Promise<AutomationRuntimeTarget> {
  return {
    key: 'local',
    client: await dependencies.getAutomationsRuntimeClient(),
  };
}
