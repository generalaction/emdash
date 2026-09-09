import { toast } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgentInstallationStatus } from '@core/features/agents/api/browser/use-agent-installation-statuses';
import { DependencyInstallationStatusCard } from '@core/features/settings/browser/agents-page/DependencyInstallationStatusCard';
import type { InstallationState } from '@core/features/settings/browser/agents-page/DependencyInstallationStatusCard';
import { DependencyInstallationUpdateCard } from '@core/features/settings/browser/agents-page/DependencyInstallationUpdateCard';
import {
  findInstallation,
  refFromUsed,
  toSelection,
} from '@core/features/settings/browser/agents-page/installation-sources';
import { InstallationOverrideCard } from '@core/features/settings/browser/agents-page/InstallationOverrideCard';
import { InstallDependencyCard } from '@core/features/settings/browser/agents-page/InstallDependencyCard';
import type {
  AgentPayload,
  InstallMethod,
  InstallOption,
  SelectedSource,
} from '@core/primitives/agents/api';

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
  compact?: boolean;
};

function isOverrideRef(
  ref: SelectedSource
): ref is { kind: 'path'; path: string } | { kind: 'cli'; command: string } {
  return ref.kind === 'path' || ref.kind === 'cli';
}

/**
 * Derives the initial selectedSource for an agent:
 *   1. A non-auto persisted override (user previously chose explicitly) — use it.
 *   2. Agent is uninstalled + a recommended install option exists — pre-select it.
 *   3. Otherwise fall back to auto.
 */
function seedSource(
  used: SelectedSource | undefined,
  status: string,
  installOptions: InstallOption[]
): SelectedSource {
  const liveRef = refFromUsed(used);
  if (liveRef.kind !== 'auto') return liveRef;
  if (status !== 'available') {
    const recommended = installOptions.find((o) => o.recommended);
    if (recommended) return { kind: 'method', method: recommended.method as InstallMethod };
  }
  return { kind: 'auto' };
}

/**
 * Status-driven composer that owns the renderer-local `selectedSource` (UI intent).
 * Override drafts are persisted only after validation succeeds.
 * Uninstalled agents with no prior override default to the recommended install method.
 */
export const InstallSection = observer(function InstallSection({
  agentId,
  connectionId,
  agentPayload,
  installOptions,
  installDocs,
  hideOverrideOptions,
  compact,
}: InstallSectionProps) {
  return (
    <LocalInstallSection
      agentId={agentId}
      connectionId={connectionId}
      agentPayload={agentPayload}
      installOptions={installOptions}
      installDocs={installDocs}
      hideOverrideOptions={hideOverrideOptions}
      compact={compact}
    />
  );
});

const LocalInstallSection = observer(function LocalInstallSection({
  agentId,
  connectionId,
  agentPayload,
  installOptions,
  installDocs: _installDocs,
  hideOverrideOptions: _hideOverrideOptions,
  compact = false,
}: InstallSectionProps) {
  const vm = useAgentInstallationStatus(
    agentId,
    hostRefFromConnectionId(connectionId),
    agentPayload
  );

  const [sourceDraft, setSourceDraft] = useState<SelectedSource | null>(null);
  const selectedSource = sourceDraft ?? seedSource(vm.used, vm.status, installOptions);
  const [isChecking, setIsChecking] = useState(false);

  // A completed install returns to the active source; background probes leave override drafts alone.
  useEffect(() => {
    if (vm.status === 'available' && !vm.isInstalling && !vm.isUpdating) {
      setSourceDraft((draft) => (draft?.kind === 'method' ? null : draft));
    }
  }, [vm.used, vm.status, vm.isInstalling, vm.isUpdating]);

  // Persisted override values used as initial inputs for the override card.
  const initialPath = useMemo(() => {
    return vm.used?.kind === 'path' ? vm.used.path : '';
  }, [vm.used]);

  const initialCli = useMemo(() => {
    return vm.used?.kind === 'cli' ? vm.used.command : '';
  }, [vm.used]);

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
    if (isOverrideRef(ref) || ref.kind === 'method') {
      setSourceDraft(ref);
      return;
    }
    void vm
      .setUsed(toSelection(ref))
      .then(() => setSourceDraft(null))
      .catch((error: unknown) => {
        toast.error('Could not change executable', {
          description:
            error && typeof error === 'object' && 'message' in error
              ? String(error.message)
              : 'Please try again.',
        });
      });
  };

  // For the install command card, narrow to the selected method when concrete.
  const effectiveInstallOptions = useMemo(() => {
    if (selectedSource.kind === 'method') {
      return installOptions.filter((o) => o.method === selectedSource.method);
    }
    return installOptions;
  }, [installOptions, selectedSource]);

  if (vm.runtimeError) {
    switch (vm.runtimeError.type) {
      case 'host-unavailable':
      case 'not-configured':
        return (
          <div
            role="alert"
            className="rounded-lg border border-border bg-background-secondary p-3 text-sm text-foreground-muted"
          >
            {vm.runtimeError.message}
          </div>
        );
    }
  }

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
          agentPayload={agentPayload}
          compact={compact}
        />
      )}

      {state !== 'found' && !isOverrideRef(selectedSource) && (
        <InstallDependencyCard
          vm={vm}
          installOptions={effectiveInstallOptions}
          isInstalling={vm.isInstalling}
          installingMethod={vm.installingMethod}
          dependencyName={agentPayload?.name ?? agentId}
          compact={compact}
        />
      )}

      {isOverrideRef(selectedSource) && (
        <InstallationOverrideCard
          key={`${selectedSource.kind}:${selectedSource.kind === 'path' ? initialPath : initialCli}`}
          vm={vm}
          kind={selectedSource.kind}
          initialValue={selectedSource.kind === 'path' ? initialPath : initialCli}
          onChecking={setIsChecking}
          onSaved={() => setSourceDraft(null)}
        />
      )}
    </div>
  );
});
