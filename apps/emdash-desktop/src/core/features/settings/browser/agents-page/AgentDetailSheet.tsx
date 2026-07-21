import { observer } from 'mobx-react-lite';
import { useAgentSettings } from '@core/features/agents/api/browser/use-agent-settings';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import { InstallSection } from '@core/features/settings/api/browser/agents-page/InstallSection';
import { Field } from '@core/primitives/ui/browser/field';
import { Label } from '@core/primitives/ui/browser/label';
import { Sheet, SheetContent, SheetHeader } from '@core/primitives/ui/browser/sheet';
import { AgentMcpSection } from './AgentMcpSection';
import { AgentSheetHeaderSection } from './AgentSheetHeaderSection';
import { InstalledAgentContent } from './InstalledAgentContent';

interface AgentDetailSheetProps {
  agentId: string | null;
  onClose: () => void;
}

const AgentDetailSheetContent = observer(function AgentDetailSheetContent({
  agentId,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const { data: agents } = useAgents();
  const agentPayload = agents?.find((a) => a.id === agentId);

  const { value: storedConfig, isOverridden, isLoading, update, reset } = useAgentSettings(agentId);

  const isInstalled = agentPayload?.status === 'available';

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
                agentPayload={agentPayload}
                installOptions={agentPayload.installOptions}
                hideOverrideOptions={!isInstalled}
              />
            </Field>
            {isInstalled && <AgentMcpSection agentId={agentId} />}
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
