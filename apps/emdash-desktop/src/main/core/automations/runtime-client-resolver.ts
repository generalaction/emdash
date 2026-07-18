import type { AutomationRuntimeAvailability } from '@core/primitives/automations/api';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import {
  getAutomationsRuntimeClient,
  type AutomationsRuntimeClient,
} from '@main/gateway/accessors';

export type AutomationRuntimeTarget = {
  key: string;
  client: AutomationsRuntimeClient;
};

const REMOTE_UNAVAILABLE_REASON =
  'This desktop build cannot reach the remote automation runtime yet.';

export async function getAutomationRuntimeAvailability(
  projectId: string | undefined
): Promise<AutomationRuntimeAvailability> {
  if (!projectId) {
    return { available: false, reason: 'Assign a project before configuring this automation.' };
  }
  const project = await getProjectById(projectId);
  if (!project) {
    return { available: false, reason: 'The automation project no longer exists.' };
  }
  if (project.type === 'ssh') {
    return { available: false, reason: REMOTE_UNAVAILABLE_REASON };
  }
  return { available: true };
}

export async function resolveAutomationRuntime(
  projectId: string | undefined
): Promise<AutomationRuntimeTarget> {
  const availability = await getAutomationRuntimeAvailability(projectId);
  if (!availability.available) throw new Error(availability.reason);

  return resolveLocalAutomationRuntime();
}

export async function resolveLocalAutomationRuntime(): Promise<AutomationRuntimeTarget> {
  return {
    key: 'local',
    client: await getAutomationsRuntimeClient(),
  };
}
