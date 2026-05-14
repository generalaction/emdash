import type { Automation } from '@shared/automations/types';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';

async function listProjectAutomations(projectId: string): Promise<Automation[]> {
  const result = await rpc.automations.list(projectId);
  if (!result.success) return [];
  return result.data;
}

function deleteProjectDescription(projectLabel: string, automations: Automation[]) {
  if (automations.length === 0) {
    return `"${projectLabel}" will be deleted. The project folder and worktrees will stay on the filesystem.`;
  }

  return (
    <div className="space-y-3">
      <p>
        "{projectLabel}" will be deleted. The project folder and worktrees will stay on the
        filesystem.
      </p>
      <div className="space-y-2">
        <p className="text-foreground-destructive">
          This will also delete {automations.length === 1 ? 'this automation' : 'these automations'}
          :
        </p>
        <ul className="max-h-32 space-y-1 overflow-auto rounded-md border border-border bg-background-secondary p-2 text-sm">
          {automations.map((automation) => (
            <li key={automation.id} className="truncate">
              {automation.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function useConfirmDeleteProject() {
  const showConfirmDeleteProject = useShowModal('confirmActionModal');

  return async ({
    projectId,
    projectLabel,
    onDeleted,
  }: {
    projectId: string;
    projectLabel: string;
    onDeleted?: () => void;
  }) => {
    const automations = await listProjectAutomations(projectId);

    showConfirmDeleteProject({
      title: 'Delete project',
      description: deleteProjectDescription(projectLabel, automations),
      confirmLabel: 'Delete',
      onSuccess: () => {
        void getProjectManagerStore().deleteProject(projectId);
        onDeleted?.();
      },
    });
  };
}
