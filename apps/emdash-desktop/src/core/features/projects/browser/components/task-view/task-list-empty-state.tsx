import { menuItemBase } from '@emdash/ui/styles/recipes/menu-item';
import { CircleDot, GitBranch, GitPullRequest, type LucideIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useConnectedIssueProviders } from '@core/features/integrations/api/browser/use-connected-issue-providers';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { taskHostActionAvailability } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { projectAvailabilityUi } from '@core/manifests/browser/project-availability-ui';
import { Shortcut } from '@core/primitives/keybindings/browser/shortcut';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { useArrowKeyNavigation } from '@core/primitives/react-hooks/browser/use-arrow-key-navigation';
import { isGitHubDotComHost } from '@core/primitives/repository/api';
import { cn } from '@core/primitives/styling/browser/cn';

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
  const openTaskModal = useOpenModal('taskModal');
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
  const createAvailability = taskHostActionAvailability(projectId);
  const createDisabledReason =
    createAvailability.kind === 'disabled'
      ? (projectAvailabilityUi.getLiveActionDisabledReason(projectId) ??
        projectAvailabilityUi.defaultLiveActionDisabledReason)
      : undefined;

  const actions: TaskAction[] = [
    {
      label: 'Create a Task from a Branch',
      description: 'Create a task from an existing branch',
      icon: GitBranch,
      disabled: !!createDisabledReason,
      disabledReason: createDisabledReason,
      onActivate: () => void openTaskModal({ projectId, strategy: 'from-branch' }),
    },
    {
      label: 'Create from Issue',
      description: hasAnyIntegration
        ? 'Link and create a task from an issue'
        : 'Configure issue integrations',
      icon: CircleDot,
      disabled: !!createDisabledReason,
      disabledReason: createDisabledReason,
      onActivate: () =>
        hasAnyIntegration
          ? void openTaskModal({ projectId, strategy: 'from-issue' })
          : navigate(settingsViewDef({ tab: 'integrations' })),
    },
    {
      label: 'Create from Pull Request',
      description: 'Create a task from a pull request',
      icon: GitPullRequest,
      disabled: !!createDisabledReason || !supportsPullRequests,
      disabledReason: createDisabledReason ?? 'No remote repository connected',
      onActivate: () => void openTaskModal({ projectId, strategy: 'from-pull-request' }),
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
          <TaskActionRow
            key={action.label}
            action={action}
            isSelected={i === selectedIndex}
            onMouseEnter={() => setSelectedIndex(i)}
          />
        ))}
      </div>
    </div>
  );
});

function TaskActionRow({
  action,
  isSelected,
  onMouseEnter,
}: {
  action: TaskAction;
  isSelected: boolean;
  onMouseEnter: () => void;
}) {
  const { label, description, icon: Icon, disabled, disabledReason, onActivate } = action;
  return (
    <button
      type="button"
      aria-label={disabledReason ? `${label}. ${disabledReason}` : label}
      disabled={disabled}
      onClick={disabled ? undefined : onActivate}
      onMouseEnter={disabled ? undefined : onMouseEnter}
      className={cn(
        menuItemBase({ fullWidth: true }),
        'justify-between',
        disabled ? 'opacity-50' : 'hover:bg-background-1',
        !disabled && isSelected && 'bg-background-1'
      )}
    >
      <div className="flex items-center gap-3">
        <Icon className="size-7 shrink-0 text-foreground-passive" strokeWidth={1} />
        <div className="flex flex-col gap-1 text-left">
          <span
            className={cn(
              'text-sm whitespace-nowrap text-foreground-muted transition-colors',
              !disabled && isSelected && 'text-foreground'
            )}
          >
            {label}
          </span>
          <span className="text-xs text-foreground-passive">
            {disabled && disabledReason ? disabledReason : description}
          </span>
        </div>
      </div>
      {!disabled && isSelected && <Shortcut hotkey="Enter" variant="keycaps" />}
    </button>
  );
}
