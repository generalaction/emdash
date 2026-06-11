import { observer } from 'mobx-react-lite';
import { useCallback } from 'react';
import { useProviderSettings } from '@renderer/features/settings/use-provider-settings';
import { appState } from '@renderer/lib/stores/app-state';
import { Sheet, SheetContent, SheetHeader } from '@renderer/lib/ui/sheet';
import { log } from '@renderer/utils/logger';
import type { ProviderCustomConfig } from '@shared/core/app-settings';
import { AgentSheetHeaderSection } from './AgentSheetHeaderSection';
import { InstalledAgentContent } from './InstalledAgentContent';
import type { UseInstallationPayload } from './InstallSection';
import { InstallSection } from './InstallSection';
import { UninstalledAgentContent } from './UninstalledAgentContent';

interface AgentDetailSheetProps {
  agentId: string | null;
  onClose: () => void;
}

const AgentDetailSheetContent = observer(function AgentDetailSheetContent({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const agentPayload = appState.dependencies.agents.data?.find((a) => a.id === agentId);

  const { value: storedConfig, isOverridden, isLoading, update, reset } =
    useProviderSettings(agentId);

  const isInstalled = agentPayload?.status === 'available';

  const handleUseInstallation = useCallback(
    (payload: UseInstallationPayload) => {
      const current = storedConfig ?? {};
      const merged: ProviderCustomConfig = {
        ...current,
        installSource: payload.installSource,
        path: payload.path !== undefined ? payload.path : current.path,
        cli: payload.cli !== undefined ? payload.cli : current.cli,
      };
      update(merged, {
        onError: (err) => log.error('Failed to save install source:', err),
      });
    },
    [storedConfig, update]
  );

  return (
    <>
      <SheetHeader label={isInstalled ? 'Agent Settings' : 'Install Agent'} />
      <div className="overflow-y-auto px-4">
        {agentPayload && (
          <div className="space-y-6">
            <AgentSheetHeaderSection agent={agentPayload} />
            <InstallSection
              agentId={agentId}
              installOptions={agentPayload.installOptions}
              installDocs={agentPayload.installDocs}
              isInstalled={isInstalled}
              updateAvailable={agentPayload.updateAvailable}
              installSource={storedConfig?.installSource}
              pathValue={storedConfig?.path}
              cliValue={storedConfig?.cli}
              onUseInstallation={handleUseInstallation}
              hideOverrideOptions={!isInstalled}
            />
          </div>
        )}
      </div>

      {agentPayload && isInstalled ? (
        <InstalledAgentContent
          storedConfig={storedConfig}
          isOverridden={isOverridden}
          isLoading={isLoading}
          update={update}
          reset={reset}
        />
      ) : (
        agentPayload && <UninstalledAgentContent onClose={onClose} />
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
