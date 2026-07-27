import { PageLayout, SettingsCard } from '@emdash/ui/react/patterns';
import { useMemo } from 'react';
import { ResourceUtilizationRow } from '../components/machine-resources';
import { MachineSystemDependenciesCard } from '../components/machine-system-dependencies';
import { createSystemDependenciesStore } from '../machines-store';
import { useMachineMetrics } from '../use-machine-metrics';

export function SystemSettingsPage() {
  const metrics = useMachineMetrics(undefined, true);
  const systemDependenciesStore = useMemo(() => createSystemDependenciesStore(), []);

  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title="System"
        description="Monitor local host resources and required system dependencies."
      />
      <SettingsCard>
        <ResourceUtilizationRow metrics={metrics} />
      </SettingsCard>
      <MachineSystemDependenciesCard machinesStore={systemDependenciesStore} />
    </div>
  );
}
