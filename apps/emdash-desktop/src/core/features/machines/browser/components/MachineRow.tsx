import { PencilIcon, ServerIcon, Trash2Icon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import type { SshConfig } from '@core/primitives/ssh/api';
import { Button } from '@core/primitives/ui/browser/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@core/primitives/ui/browser/tooltip';
import { appState } from '@renderer/lib/stores/app-state';
import { authLabel, projectUsageNamesText, projectUsageText } from './machine-formatters';
import { MachineBadge } from './MachineBadge';

type MachineProjectUsage = Array<{ id: string; name: string }>;

function MachineActionButton({
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
              size="icon-xs"
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

export const MachineRow = observer(function MachineRow({
  machine,
  projects,
  isDeleting,
  onEdit,
  onDelete,
}: {
  machine: SshConfig;
  projects: MachineProjectUsage;
  isDeleting: boolean;
  onEdit: (machine: SshConfig) => void;
  onDelete: (machine: SshConfig) => void | Promise<void>;
}) {
  const state = appState.machines.stateFor(machine.id);
  const projectUsageNames = projectUsageNamesText(projects);
  const allProjectNames = projects.map((project) => project.name).join(', ');

  return (
    <div className="flex min-w-0 items-start gap-4 rounded-lg border border-border bg-background p-4">
      <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md text-foreground-muted">
        <ServerIcon className="size-4" />
      </div>
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="min-w-0 truncate text-sm font-medium text-foreground">{machine.name}</h4>
          <MachineBadge state={state} />
        </div>
        <div className="min-w-0 space-y-1 text-xs text-foreground-passive">
          <p className="truncate">
            {machine.username}@{machine.host}:{machine.port}
          </p>
          <p className="truncate">Auth: {authLabel(machine)}</p>
          <p className="truncate">Used by: {projectUsageText(projects)}</p>
        </div>
        {projectUsageNames && (
          <p className="truncate text-xs text-foreground-passive" title={allProjectNames}>
            Projects: {projectUsageNames}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <MachineActionButton label={`Edit ${machine.name}`} onClick={() => onEdit(machine)}>
          <PencilIcon className="size-4" />
        </MachineActionButton>
        <MachineActionButton
          label={`Delete ${machine.name}`}
          className="hover:bg-destructive/10 text-foreground-destructive hover:text-foreground-destructive"
          disabled={isDeleting}
          onClick={() => void onDelete(machine)}
        >
          <Trash2Icon className="size-4" />
        </MachineActionButton>
      </div>
    </div>
  );
});
