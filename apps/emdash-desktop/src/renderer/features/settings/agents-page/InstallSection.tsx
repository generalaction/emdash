import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgentInstallationStatus } from '@renderer/lib/stores/use-agent-installation-statuses';
import type {
  AgentPayload,
  Installation,
  InstallOption,
  SelectedSource,
} from '@shared/core/agents/agent-payload';
import { sourceKey } from '@shared/core/agents/agent-payload';
import { DependencyInstallationStatusCard } from './DependencyInstallationStatusCard';
import type { InstallationState } from './DependencyInstallationStatusCard';
import { DependencyInstallationUpdateCard } from './DependencyInstallationUpdateCard';
import { findInstallation, refFromUsed, toSelection } from './installation-sources';
import { InstallationOverrideCard } from './InstallationOverrideCard';
import { InstallDependencyCard } from './InstallDependencyCard';

export type InstallSectionProps = {
  agentId: string;
  /** SSH connection id; when provided, install/update/status operate on the remote host. */
  connectionId?: string;
  /** Full agent payload used to hydrate the hook before the first probe. */
  agentPayload: AgentPayload | undefined;
  /** Platform-specific install options from the agent payload. */
  installOptions: InstallOption[];
  /** Link to installation documentation, null if not set. */
  installDocs?: string | null;
  /** @deprecated No-op; override options are always visible in the source menu. */
  hideOverrideOptions?: boolean;
};

function isOverrideRef(
  ref: SelectedSource
): ref is { kind: 'path'; path: string } | { kind: 'cli'; command: string } {
  return ref.kind === 'path' || ref.kind === 'cli';
}

/**
 * Status-driven composer that owns the renderer-local `selectedSource` (UI intent).
 * After an install/update the selection converges with vm.used automatically since
 * the controller now persists the chosen method on install.
 */
export const InstallSection = observer(function InstallSection({
  agentId,
  connectionId,
  agentPayload,
  installOptions,
  installDocs: _installDocs,
  hideOverrideOptions: _hideOverrideOptions,
}: InstallSectionProps) {
  const vm = useAgentInstallationStatus(agentId, connectionId, agentPayload);

  const [selectedSource, setSelectedSource] = useState<SelectedSource>(() => refFromUsed(vm.used));
  const [isChecking, setIsChecking] = useState(false);

  // Tracks whether the user has manually staged a source. We only follow
  // background vm.used changes into selectedSource when they have not.
  const userStagedRef = useRef(false);

  useEffect(() => {
    if (!userStagedRef.current && vm.used) {
      const liveRef = refFromUsed(vm.used);
      setSelectedSource((prev) => (sourceKey(prev) !== sourceKey(liveRef) ? liveRef : prev));
    }
    // Sync after install/update: clear the staged flag and follow vm.used
    if (userStagedRef.current && vm.used && !vm.isInstalling && !vm.isUpdating) {
      userStagedRef.current = false;
      setSelectedSource(refFromUsed(vm.used));
    }
  }, [vm.used, vm.isInstalling, vm.isUpdating]);

  // Persisted override values used as initial inputs for the override card.
  const initialPath = useMemo(() => {
    const inst = vm.installations.find((i) => i.id === 'path');
    return inst?.source.kind === 'path' ? inst.source.path : '';
  }, [vm.installations]);

  const initialCli = useMemo(() => {
    const inst = vm.installations.find((i) => i.id === 'cli');
    return inst?.source.kind === 'cli' ? inst.source.command : '';
  }, [vm.installations]);

  const selectedInstall = findInstallation(vm.installations, selectedSource);

  const isOverrideEmpty =
    isOverrideRef(selectedSource) &&
    ((selectedSource.kind === 'path' && !initialPath) ||
      (selectedSource.kind === 'cli' && !initialCli));

  const state: InstallationState = (() => {
    if (isChecking || vm.isInstalling) return 'checking';
    if (selectedInstall?.status === 'available') return 'found';
    if (isOverrideRef(selectedSource) && isOverrideEmpty) return 'uninstalled';
    return 'not-found';
  })();

  const onSelectSource = (ref: SelectedSource) => {
    userStagedRef.current = true;
    const match = findInstallation(vm.installations, ref);
    if (match?.status === 'available') {
      void vm.setUsed(toSelection(ref, { path: initialPath, cli: initialCli }));
      userStagedRef.current = false;
    }
    setSelectedSource(ref);
  };

  const onOverrideResolved = (installation: Installation | null) => {
    if (installation?.status === 'available') {
      void vm.setUsed(
        toSelection(selectedSource, {
          path: installation.source.kind === 'path' ? installation.source.path : undefined,
          cli: installation.source.kind === 'cli' ? installation.source.command : undefined,
        })
      );
    }
  };

  // For the install command card, narrow to the selected method when concrete.
  const effectiveInstallOptions = useMemo(() => {
    if (selectedSource.kind === 'method') {
      return installOptions.filter((o) => o.method === selectedSource.method);
    }
    return installOptions;
  }, [installOptions, selectedSource]);

  return (
    <div className="space-y-2">
      <DependencyInstallationStatusCard
        vm={vm}
        agentPayload={agentPayload}
        installOptions={installOptions}
        selectedSource={selectedSource}
        state={state}
        onSelectSource={onSelectSource}
      />

      {state === 'found' && (
        <DependencyInstallationUpdateCard
          agentId={agentId}
          connectionId={connectionId}
          agentPayload={agentPayload}
        />
      )}

      {state !== 'found' && !isOverrideRef(selectedSource) && (
        <InstallDependencyCard
          vm={vm}
          installOptions={effectiveInstallOptions}
          isInstalling={vm.isInstalling}
          installingMethod={vm.installingMethod}
        />
      )}

      {state !== 'found' && isOverrideRef(selectedSource) && (
        <InstallationOverrideCard
          vm={vm}
          kind={selectedSource.kind}
          initialValue={selectedSource.kind === 'path' ? initialPath : initialCli}
          onChecking={setIsChecking}
          onResolved={onOverrideResolved}
        />
      )}
    </div>
  );
});
