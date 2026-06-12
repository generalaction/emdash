import { observer } from 'mobx-react-lite';
import { useAgentSettings } from '@renderer/lib/stores/use-agent-settings';
import { useAgents } from '@renderer/lib/stores/use-agents';
import { Field } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import { Sheet, SheetContent, SheetHeader } from '@renderer/lib/ui/sheet';
import { AgentMcpSection } from './AgentMcpSection';
import { AgentSheetHeaderSection } from './AgentSheetHeaderSection';
import { InstalledAgentContent } from './InstalledAgentContent';
import { InstallSection } from './InstallSection';

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
