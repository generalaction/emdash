import { CircleDot, GitBranch, GitPullRequest, type LucideIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useIntegrationsContext } from '@renderer/features/integrations/integrations-provider';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { useArrowKeyNavigation } from '@renderer/lib/hooks/use-arrow-key-navigation';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { ActionListItem } from '@renderer/lib/ui/action-list-item';

type TaskStrategy = 'from-branch' | 'from-issue' | 'from-pull-request';

interface TaskAction {
  label: string;
  description: string;
  icon: LucideIcon;
  strategy: TaskStrategy;
  disabled: boolean;
  disabledReason?: string;
}

export const TaskListEmptyState = observer(function TaskListEmptyState({
  projectId,
}: {
  projectId: string;
}) {
  const showTaskModal = useShowModal('taskModal');
  const { connectionStatus } = useIntegrationsContext();
  const repositoryUrl = getRepositoryStore(projectId)?.repositoryUrl ?? null;
  const hasAnyIntegration = Object.values(connectionStatus).some((s) => s.connected);

  const actions: TaskAction[] = [
    {
      label: 'Create a Task from a Branch',
      description: 'Create a task from an existing branch',
      icon: GitBranch,
      strategy: 'from-branch',
      disabled: false,
    },
    {
      label: 'Create from Issue',
      description: 'Link and create a task from an issue',
      icon: CircleDot,
      strategy: 'from-issue',
      disabled: !hasAnyIntegration,
      disabledReason: 'Configure issue integrations',
    },
    {
      label: 'Create from Pull Request',
      description: 'Create a task from a pull request',
      icon: GitPullRequest,
      strategy: 'from-pull-request',
      disabled: !repositoryUrl,
      disabledReason: 'No remote repository connected',
    },
  ];

  const { selectedIndex, setSelectedIndex } = useArrowKeyNavigation(actions.length, (index) => {
    const action = actions[index];
    if (action && !action.disabled) showTaskModal({ projectId, strategy: action.strategy });
  });

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 bg-background">
      <div className="flex flex-col w-full max-w-sm gap-1">
        {actions.map((action, i) => (
          <ActionListItem
            key={action.strategy}
            label={action.label}
            description={action.description}
            icon={action.icon}
            isSelected={i === selectedIndex}
            disabled={action.disabled}
            disabledReason={action.disabledReason}
            onMouseEnter={() => setSelectedIndex(i)}
            onClick={() => {
              if (!action.disabled) showTaskModal({ projectId, strategy: action.strategy });
            }}
          />
        ))}
      </div>
    </div>
  );
});
