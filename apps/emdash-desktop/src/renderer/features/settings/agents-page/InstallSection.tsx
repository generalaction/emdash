import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { useAgentInstallationStatus } from '@renderer/lib/stores/use-agent-installation-statuses';
import type { InstallOption } from '@shared/core/agents/agent-payload';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import { DependencyInstallationStatusCard } from './DependencyInstallationStatusCard';
import { DependencyInstallationUpdateCard } from './DependencyInstallationUpdateCard';
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
  installDocs: string | null;
  /**
   * When true, the synthetic "CLI Override" and "Path Override" select entries are hidden.
   * Use in the uninstalled view where these overrides are not meaningful.
   */
  hideOverrideOptions?: boolean;
};

/**
 * Status-driven composer that renders the appropriate installation card(s) based on
 * the current host-scoped dependency state from useAgentInstallationStatus.
 *
 * The hook is the single source of truth; select rows and status badges always
 * read from the same `installations`/`used`/`status` objects.
 */
export const InstallSection = observer(function InstallSection({
  agentId,
  connectionId,
  agentPayload,
  installOptions,
  hideOverrideOptions = false,
}: InstallSectionProps) {
  const vm = useAgentInstallationStatus(agentId, connectionId, agentPayload);

  const isInstalled = vm.status === 'available';

  // Derive initial path/cli values from the hook's installations for the install card inputs
  const initialPath = useMemo(() => {
    const inst = vm.installations.find((i) => i.id === 'path');
    return inst?.source.kind === 'path' ? inst.source.path : '';
  }, [vm.installations]);

  const initialCli = useMemo(() => {
    const inst = vm.installations.find((i) => i.id === 'cli');
    return inst?.source.kind === 'cli' ? inst.source.command : '';
  }, [vm.installations]);

  return (
    <div className="space-y-2">
      {/* Status card: shown when an installation is found */}
      {isInstalled && <DependencyInstallationStatusCard vm={vm} agentPayload={agentPayload} />}

      {/* Update card: shown when the used installation has an update available */}
      {isInstalled && (
        <DependencyInstallationUpdateCard
          agentId={agentId}
          connectionId={connectionId}
          agentPayload={agentPayload}
        />
      )}

      {!isInstalled && (
        <InstallDependencyCard
          vm={vm}
          installOptions={installOptions}
          hideOverrideOptions={hideOverrideOptions}
          initialPath={initialPath}
          initialCli={initialCli}
          isInstalling={vm.isInstalling}
          installingMethod={vm.installingMethod}
        />
      )}
    </div>
  );
});
