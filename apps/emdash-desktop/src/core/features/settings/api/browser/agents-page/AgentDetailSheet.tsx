import { observer } from 'mobx-react-lite';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgentSettings } from '@core/features/agents/api/browser/use-agent-settings';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import { Field } from '@core/primitives/ui/browser/field';
import { Label } from '@core/primitives/ui/browser/label';
import { Sheet, SheetContent, SheetHeader } from '@core/primitives/ui/browser/sheet';
import { AgentMcpSection } from '../../../browser/agents-page/AgentMcpSection';
import { AgentSheetHeaderSection } from '../../../browser/agents-page/AgentSheetHeaderSection';
import { InstalledAgentContent } from '../../../browser/agents-page/InstalledAgentContent';
import { InstallSection } from './InstallSection';

interface AgentDetailSheetProps {
  agentId: string | null;
  connectionId?: string;
  onClose: () => void;
}

const AgentDetailSheetContent = observer(function AgentDetailSheetContent({
  agentId,
  connectionId,
}: {
  agentId: string;
  connectionId?: string;
  onClose: () => void;
}) {
  const host = hostRefFromConnectionId(connectionId);
  const { data: agents } = useAgents(host);
  const agentPayload = agents?.find((a) => a.id === agentId);

  const { value: storedConfig, isOverridden, isLoading, update, reset } = useAgentSettings(agentId);

  const isInstalled = agentPayload?.status === 'available';
  const isRemote = !!connectionId;

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
                connectionId={connectionId}
                agentPayload={agentPayload}
                installOptions={agentPayload.installOptions}
                hideOverrideOptions={!isInstalled || isRemote}
              />
            </Field>
            {isInstalled && !isRemote && <AgentMcpSection agentId={agentId} />}
          </div>
        )}
      </div>
      {agentPayload && isInstalled && !isRemote && (
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

export function AgentDetailSheet({ agentId, connectionId, onClose }: AgentDetailSheetProps) {
  return (
    <Sheet open={agentId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0">
        {agentId && (
          <AgentDetailSheetContent
            agentId={agentId}
            connectionId={connectionId}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
