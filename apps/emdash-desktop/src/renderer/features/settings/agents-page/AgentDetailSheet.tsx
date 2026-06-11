import { observer } from 'mobx-react-lite';
import { useCallback, useMemo } from 'react';
import { useProviderSettings } from '@renderer/features/settings/use-provider-settings';
import { appState } from '@renderer/lib/stores/app-state';
import { Field } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import { Sheet, SheetContent, SheetHeader } from '@renderer/lib/ui/sheet';
import { log } from '@renderer/utils/logger';
import type { HostDependencySelection } from '@shared/core/dependencies';
import type { DependencyId } from '@shared/core/dependencies';
import { AgentSheetHeaderSection } from './AgentSheetHeaderSection';
import { InstalledAgentContent } from './InstalledAgentContent';
import { InstallSection } from './InstallSection';

interface AgentDetailSheetProps {
  agentId: string | null;
  onClose: () => void;
}

const AgentDetailSheetContent = observer(function AgentDetailSheetContent({
  agentId,
  onClose: _onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const agentPayload = appState.dependencies.agents.data?.find((a) => a.id === agentId);

  const {
    value: storedConfig,
    isOverridden,
    isLoading,
    update,
    reset,
  } = useProviderSettings(agentId);

  const isInstalled = agentPayload?.status === 'available';

  const handleUseInstallation = useCallback(
    async (selection: HostDependencySelection) => {
      try {
        await appState.dependencies.setUsedInstallation(
          agentId as DependencyId,
          undefined,
          selection
        );
      } catch (err) {
        log.error('Failed to save install source:', err);
      }
    },
    [agentId]
  );

  const pathValue = useMemo(
    () =>
      agentPayload?.installations.find((i) => i.id === 'path')?.source as
        | { kind: 'path'; path: string }
        | undefined,
    [agentPayload?.installations]
  );

  const cliValue = useMemo(
    () =>
      agentPayload?.installations.find((i) => i.id === 'cli')?.source as
        | { kind: 'cli'; command: string }
        | undefined,
    [agentPayload?.installations]
  );

  return (
    <>
      <SheetHeader label={isInstalled ? 'Agent Settings' : 'Install Agent'} />
      <div className="overflow-y-auto px-4">
        {agentPayload && (
          <div className="space-y-6">
            <AgentSheetHeaderSection agent={agentPayload} />
            <Field>
              <Label>Installation</Label>
              <InstallSection
                agentId={agentId}
                installOptions={agentPayload.installOptions}
                installDocs={agentPayload.installDocs}
                isInstalled={isInstalled}
                updateAvailable={agentPayload.updateAvailable}
                usedInstallationId={agentPayload.usedId || null}
                pathValue={pathValue?.path}
                cliValue={cliValue?.command}
                onUseInstallation={handleUseInstallation}
                hideOverrideOptions={!isInstalled}
              />
            </Field>
          </div>
        )}
      </div>
      {agentPayload && isInstalled && (
        <InstalledAgentContent
          storedConfig={storedConfig}
          isOverridden={isOverridden}
          isLoading={isLoading}
          update={update}
          reset={reset}
        />
      )}
    </>
  );
});

export function AgentDetailSheet({ agentId, onClose }: AgentDetailSheetProps) {
  return (
    <Sheet open={agentId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0">
        {agentId && <AgentDetailSheetContent agentId={agentId} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}
