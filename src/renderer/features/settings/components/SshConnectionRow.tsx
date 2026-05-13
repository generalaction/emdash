import { PencilIcon, ServerIcon, Trash2Icon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import type { SshConfig } from '@shared/ssh';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { authLabel, projectUsageNamesText, projectUsageText } from './ssh-connection-formatters';
import { SshStateBadge } from './SshStateBadge';

type SshConnectionProjectUsage = Array<{ id: string; name: string }>;

function ConnectionActionButton({
  label,
  children,
  disabled,
  className,
  onClick,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={className}
              onClick={onClick}
              disabled={disabled}
              aria-label={label}
            >
              {children}
            </Button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const SshConnectionRow = observer(function SshConnectionRow({
  connection,
  projects,
  isDeleting,
  onEdit,
  onDelete,
}: {
  connection: SshConfig;
  projects: SshConnectionProjectUsage;
  isDeleting: boolean;
  onEdit: (connection: SshConfig) => void;
  onDelete: (connection: SshConfig) => void;
}) {
  const state = appState.sshConnections.stateFor(connection.id);
  const projectUsageNames = projectUsageNamesText(projects);
  const allProjectNames = projects.map((project) => project.name).join(', ');

  return (
    <div className="flex min-w-0 items-start gap-4 rounded-lg border border-border bg-background p-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground-muted">
        <ServerIcon className="size-4" />
      </div>
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="min-w-0 truncate text-sm font-medium text-foreground">
            {connection.name}
          </h4>
          <SshStateBadge state={state} />
        </div>
        <div className="min-w-0 space-y-1 text-xs text-foreground-passive">
          <p className="truncate">
            {connection.username}@{connection.host}:{connection.port}
          </p>
          <p className="truncate">Auth: {authLabel(connection)}</p>
          {connection.worktreesDir && (
            <p className="truncate">Worktrees: {connection.worktreesDir}</p>
          )}
          <p className="truncate">Used by: {projectUsageText(projects)}</p>
        </div>
        {projectUsageNames && (
          <p className="truncate text-xs text-foreground-passive" title={allProjectNames}>
            Projects: {projectUsageNames}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ConnectionActionButton
          label={`Edit ${connection.name}`}
          onClick={() => onEdit(connection)}
        >
          <PencilIcon className="size-4" />
        </ConnectionActionButton>
        <ConnectionActionButton
          label={`Delete ${connection.name}`}
          className="text-foreground-destructive hover:bg-destructive/10 hover:text-foreground-destructive"
          disabled={isDeleting}
          onClick={() => onDelete(connection)}
        >
          <Trash2Icon className="size-4" />
        </ConnectionActionButton>
      </div>
    </div>
  );
});
