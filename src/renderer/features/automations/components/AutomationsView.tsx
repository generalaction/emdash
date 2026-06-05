import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { Sheet, SheetContent } from '@renderer/lib/ui/sheet';
import type { Automation } from '@shared/automations/automation';
import { useAutomations } from '../use-automations';
import { useAutomationsPanel } from '../use-automations-panel';
import { AutomationDetailView } from './AutomationDetailView';
import { AutomationsHeader } from './AutomationsHeader';
import { AutomationsList } from './AutomationsList';
import { CreateAutomationView } from './CreateAutomationView';

export function AutomationsView() {
  const { data: automations } = useQuery({
    queryKey: ['automations'],
    queryFn: () => rpc.automations.listAutomations(),
  });
  const [search, setSearch] = useState('');

  const panel = useAutomationsPanel(automations ?? []);
  const { setEnabled, destroy } = useAutomations();

  function handleToggleEnabled(automation: Automation, enabled: boolean) {
    void setEnabled.mutateAsync({ id: automation.id, enabled });
  }

  function handleDelete(automation: Automation) {
    void destroy.mutateAsync(automation.id).then(() => panel.close());
  }

  return (
    <div className="mt-6 h-full overflow-hidden bg-background text-foreground">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-4xl grid-cols-1 gap-8 px-8">
        <div className="relative min-h-0 w-full min-w-0 overflow-y-auto">
          <div className="w-full py-8">
            <AutomationsHeader
              search={search}
              onSearchChange={setSearch}
              createPending={false}
              onNewAutomation={panel.openCreate}
            />
            <AutomationsList
              automations={automations ?? []}
              onEdit={panel.openEdit}
              onToggleEnabled={handleToggleEnabled}
            />
          </div>
        </div>
      </div>
      <Sheet open={panel.isOpen} onOpenChange={(open) => !open && panel.close()}>
        <SheetContent>
          {panel.panel?.kind === 'create' && (
            <CreateAutomationView onClose={panel.close} onSaved={panel.close} />
          )}
          {panel.panel?.kind === 'edit' && (
            <AutomationDetailView
              automation={panel.panel.automation}
              onClose={panel.close}
              onDelete={handleDelete}
              onToggleEnabled={handleToggleEnabled}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
