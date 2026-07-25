import { SettingsCard } from '@emdash/ui/react/patterns';
import { Button } from '@emdash/ui/react/primitives';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  MachineSystemDependencyStatus,
  MachineSystemDependencyTier,
} from '@core/features/machines/api';
import { cn } from '@core/primitives/ui/browser/cn';
import type { MachinesStore } from '../machines-store';
import { useSystemDependencies } from '../use-system-dependencies';

type SystemDependencyFilter = 'all' | MachineSystemDependencyTier;

type MachineSystemDependenciesCardProps = {
  machineId: string;
  machinesStore: MachinesStore;
};

const filterOptions: { id: SystemDependencyFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'required', label: 'Required' },
  { id: 'recommended', label: 'Recommended' },
];

const tierOrder: Record<MachineSystemDependencyTier, number> = {
  required: 0,
  recommended: 1,
};

export function MachineSystemDependenciesCard({
  machineId,
  machinesStore,
}: MachineSystemDependenciesCardProps) {
  const [filter, setFilter] = useState<SystemDependencyFilter>('all');
  const { data, error, install, installAll, installingIds, isInstalling, isLoading } =
    useSystemDependencies(machineId, true, machinesStore);

  const dependencies = useMemo(
    () =>
      [...(data ?? [])].sort((left, right) => {
        const tierDelta = tierOrder[left.tier] - tierOrder[right.tier];
        return tierDelta || left.name.localeCompare(right.name);
      }),
    [data]
  );

  const filteredDependencies = useMemo(
    () =>
      filter === 'all'
        ? dependencies
        : dependencies.filter((dependency) => dependency.tier === filter),
    [dependencies, filter]
  );

  const installableMissingDependencies = useMemo(
    () =>
      dependencies.filter(
        (dependency) => dependency.status !== 'available' && dependency.installOptions.length > 0
      ),
    [dependencies]
  );

  const canInstallAll = installableMissingDependencies.length > 0 && !isInstalling;

  return (
    <SettingsCard>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">System dependencies</div>
            <div className="text-xs text-foreground-muted">
              Host tools used by Emdash and coding-agent workflows.
            </div>
          </div>
          <div className="flex items-center gap-1">
            {filterOptions.map((option) => (
              <Button
                key={option.id}
                type="button"
                variant={filter === option.id ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!canInstallAll}
            onClick={() => void installAll(installableMissingDependencies)}
          >
            {isInstalling ? <Loader2 className="size-3.5 animate-spin" /> : 'Install all'}
          </Button>
        </div>

        {isLoading ? (
          <div className="p-4 text-sm text-foreground-muted">Checking system dependencies...</div>
        ) : error ? (
          <div className="text-destructive p-4 text-sm">
            Failed to load system dependencies: {error.message}
          </div>
        ) : filteredDependencies.length === 0 ? (
          <div className="p-4 text-sm text-foreground-muted">
            No dependencies match this filter.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredDependencies.map((dependency) => (
              <SystemDependencyRow
                key={dependency.id}
                dependency={dependency}
                installing={installingIds.has(dependency.id)}
                onInstall={() => {
                  const option =
                    dependency.installOptions.find((candidate) => candidate.recommended) ??
                    dependency.installOptions[0];
                  void install(dependency.id, option?.method);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </SettingsCard>
  );
}

function SystemDependencyRow({
  dependency,
  installing,
  onInstall,
}: {
  dependency: MachineSystemDependencyStatus;
  installing: boolean;
  onInstall: () => void;
}) {
  const available = dependency.status === 'available';
  const canInstall = !available && dependency.installOptions.length > 0;

  return (
    <div className="flex min-w-0 items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm font-medium">{dependency.name}</div>
          <span className="shrink-0 rounded bg-background-1 px-1.5 py-0.5 text-[11px] text-foreground-muted capitalize">
            {dependency.tier}
          </span>
        </div>
        <DependencySubtext dependency={dependency} />
      </div>
      {available ? (
        <CheckCircle2 className="size-4 shrink-0 text-foreground-success" />
      ) : canInstall ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={installing}
          onClick={onInstall}
        >
          {installing ? <Loader2 className="size-3.5 animate-spin" /> : 'Install'}
        </Button>
      ) : (
        <span className="shrink-0 text-xs text-foreground-muted">Not found</span>
      )}
    </div>
  );
}

function DependencySubtext({ dependency }: { dependency: MachineSystemDependencyStatus }) {
  if (dependency.path) {
    return (
      <div className="truncate text-xs text-foreground-muted" title={dependency.path}>
        {dependency.path}
      </div>
    );
  }

  if (dependency.installDocs && dependency.installOptions.length === 0) {
    return (
      <a
        className={cn('text-xs text-foreground-muted underline hover:text-foreground')}
        href={dependency.installDocs}
        target="_blank"
        rel="noreferrer"
      >
        Install manually
      </a>
    );
  }

  return <div className="text-xs text-foreground-muted">Not detected on PATH</div>;
}
