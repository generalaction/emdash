import { CircleDot, GitBranch, GitPullRequest, type LucideIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useConnectedIssueProviders } from '@renderer/features/integrations/use-connected-issue-providers';
import { getGitRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { useArrowKeyNavigation } from '@renderer/lib/hooks/use-arrow-key-navigation';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { ActionListItem } from '@renderer/lib/ui/action-list-item';
import { isGitHubDotComHost } from '@shared/repository-ref';

interface TaskAction {
  label: string;
  description: string;
  icon: LucideIcon;
  disabled: boolean;
  disabledReason?: string;
  onActivate: () => void;
}

export const TaskListEmptyState = observer(function TaskListEmptyState({
  projectId,
}: {
  projectId: string;
}) {
  const showTaskModal = useShowModal('taskModal');
  const { navigate } = useNavigate();
  const { hasAnyIssueIntegration } = useConnectedIssueProviders();
  const repositoryStore = getGitRepositoryStore(projectId);
  const supportsPullRequests = Boolean(repositoryStore?.pullRequestRepositoryUrl);
  const supportsGhesIssues = Boolean(
    repositoryStore?.issueRepositoryUrl &&
    repositoryStore.providerRepository?.host &&
    !isGitHubDotComHost(repositoryStore.providerRepository.host)
  );
  const hasAnyIntegration = supportsGhesIssues || hasAnyIssueIntegration;

  const actions: TaskAction[] = [
    {
      label: 'Create a Task from a Branch',
      description: 'Create a task from an existing branch',
      icon: GitBranch,
      disabled: false,
      onActivate: () => showTaskModal({ projectId, strategy: 'from-branch' }),
    },
    {
      label: 'Create from Issue',
      description: hasAnyIntegration
        ? 'Link and create a task from an issue'
        : 'Configure issue integrations',
      icon: CircleDot,
      disabled: false,
      onActivate: () =>
        hasAnyIntegration
          ? showTaskModal({ projectId, strategy: 'from-issue' })
          : navigate('settings', { tab: 'integrations' }),
    },
    {
      label: 'Create from Pull Request',
      description: 'Create a task from a pull request',
      icon: GitPullRequest,
      disabled: !supportsPullRequests,
      disabledReason: 'No remote repository connected',
      onActivate: () => showTaskModal({ projectId, strategy: 'from-pull-request' }),
    },
  ];

  const { selectedIndex, setSelectedIndex } = useArrowKeyNavigation(actions.length, (index) => {
    const action = actions[index];
    if (action && !action.disabled) action.onActivate();
  });

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-8">
      <div className="flex w-full max-w-sm flex-col gap-1">
        {actions.map((action, i) => (
          <ActionListItem
            key={action.label}
            label={action.label}
            description={action.description}
            icon={action.icon}
            isSelected={i === selectedIndex}
            disabled={action.disabled}
            disabledReason={action.disabledReason}
            onMouseEnter={() => setSelectedIndex(i)}
            onClick={() => {
              if (!action.disabled) action.onActivate();
            }}
          />
        ))}
      </div>
    </div>
  );
});
