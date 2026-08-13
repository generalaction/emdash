import { Tooltip } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import type { ReactElement } from 'react';
import { getMachinesStore } from '@core/features/machines/contributions/app-stores';
import { projectLiveActionDisabledReason } from '@core/features/projects/api/browser/project-availability-classifier';
import {
  asAvailableProject,
  getProjectStore,
} from '@core/features/projects/api/browser/stores/project-selectors';

export const ProjectLiveActionGuard = observer(function ProjectLiveActionGuard({
  children,
  projectId,
}: {
  children: ReactElement;
  projectId: string;
}) {
  const reason = getProjectLiveActionDisabledReason(projectId);
  if (!reason) return children;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<span className="inline-flex" tabIndex={0} role="note" aria-label={reason} />}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content>{reason}</Tooltip.Content>
    </Tooltip.Root>
  );
});

export function getProjectLiveActionDisabledReason(projectId: string): string | null {
  const context = asAvailableProject(getProjectStore(projectId));
  if (!context || context.host.state.kind === 'ready') return null;
  const project = context.project;
  const machine =
    project.type === 'ssh'
      ? getMachinesStore().connections.find((connection) => connection.id === project.connectionId)
      : undefined;
  return projectLiveActionDisabledReason({
    host:
      project.type === 'local'
        ? { kind: 'local' }
        : { kind: 'ssh', ...(machine?.name ? { machineName: machine.name } : {}) },
    state: context.host.state,
  });
}
