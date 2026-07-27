import type { InstallMethod } from '@emdash/core/services/host-dependencies/api';
import { SettingsCard } from '@emdash/ui/react/patterns';
import { Box, Button, Heading, Surface } from '@emdash/ui/react/primitives';
import { Field } from '@emdash/ui/react/primitives';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import type { MachineSystemDependencyStatus } from '@core/features/machines/api';
import type { MachinesStore } from '../machines-store';
import { useSystemDependencies } from '../use-system-dependencies';

type MachineSystemDependenciesCardProps = {
  machineId: string;
  machinesStore: MachinesStore;
};

export function MachineSystemDependenciesCard({
  machineId,
  machinesStore,
}: MachineSystemDependenciesCardProps) {
  const { data, error, install, installAll, installingIds, isInstalling, isLoading } =
    useSystemDependencies(machineId, true, machinesStore);

  const dependencies = useMemo(
    () => [...(data ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [data]
  );

  const requiredDependencies = useMemo(
    () => dependencies.filter((dependency) => dependency.tier === 'required'),
    [dependencies]
  );

  const recommendedDependencies = useMemo(
    () => dependencies.filter((dependency) => dependency.tier === 'recommended'),
    [dependencies]
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
      <div className="flex items-center gap-2">
        <Field.Root>
          <Field.Label>System dependencies</Field.Label>
          <Field.Description>
            Host tools used by Emdash and coding-agent workflows.
          </Field.Description>
        </Field.Root>
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
      <div className="mt-4">
        {isLoading ? (
          <div className="p-4 text-sm text-foreground-muted">Checking system dependencies...</div>
        ) : error ? (
          <div className="text-destructive p-4 text-sm">
            Failed to load system dependencies: {error.message}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <DependencySection
              title="Required"
              dependencies={requiredDependencies}
              installingIds={installingIds}
              onInstall={install}
            />
            <DependencySection
              title="Recommended"
              dependencies={recommendedDependencies}
              installingIds={installingIds}
              onInstall={install}
            />
          </div>
        )}
      </div>
    </SettingsCard>
  );
}

function DependencySection({
  title,
  dependencies,
  installingIds,
  onInstall,
}: {
  title: string;
  dependencies: MachineSystemDependencyStatus[];
  installingIds: Set<string>;
  onInstall: (dependencyId: string, method?: InstallMethod) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Heading level={4} tone="muted">
        {title}
      </Heading>
      {dependencies.length === 0 ? (
        <div className="p-4 text-sm text-foreground-muted">
          No {title.toLowerCase()} dependencies.
        </div>
      ) : (
        <Box surface='sunken' borderRadius='md' padding='3'>
        <div className="divide-y divide-border">
          {dependencies.map((dependency) => (
            <SystemDependencyRow
              key={dependency.id}
              dependency={dependency}
              installing={installingIds.has(dependency.id)}
              onInstall={() => {
                const option =
                  dependency.installOptions.find((candidate) => candidate.recommended) ??
                  dependency.installOptions[0];
                onInstall(dependency.id, option?.method);
              }}
            />
          ))}
        </div>
        </Box>
      )}
    </div>
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

      <div className="flex min-w-0 items-center gap-3 h-10">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs">{dependency.name}</div>
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
