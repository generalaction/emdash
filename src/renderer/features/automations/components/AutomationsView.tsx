import { useState } from 'react';
import { Sheet, SheetContent } from '@renderer/lib/ui/sheet';
import type { Automation, BuiltinAutomationTemplate } from '@shared/automations/automation';
import { useAutomations } from '../use-automations';
import { AutomationDetailView } from './AutomationDetailView';
import { AutomationsHeader } from './AutomationsHeader';
import { AutomationsList } from './AutomationsList';
import { CreateAutomationView } from './CreateAutomationView';

type PanelState =
  | { kind: 'create'; template?: BuiltinAutomationTemplate }
  | { kind: 'edit'; automation: Automation }
  | null;

export function AutomationsView() {
  const { automations, setEnabled, destroy } = useAutomations();
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<PanelState>(null);

  function handleToggleEnabled(automation: Automation, enabled: boolean) {
    void setEnabled.mutateAsync({ id: automation.id, enabled });
  }

  function handleDelete(automation: Automation) {
    void destroy.mutateAsync(automation.id).then(() => setPanel(null));
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
              onNewAutomation={() => setPanel({ kind: 'create' })}
            />
            <AutomationsList
              automations={automations.data ?? []}
              onEdit={(automation) => setPanel({ kind: 'edit', automation })}
              onToggleEnabled={handleToggleEnabled}
            />
          </div>
        </div>
      </div>
      <Sheet open={panel !== null} onOpenChange={(open) => !open && setPanel(null)}>
        <SheetContent>
          {panel?.kind === 'create' && (
            <CreateAutomationView onClose={() => setPanel(null)} onSaved={() => setPanel(null)} />
          )}
          {panel?.kind === 'edit' && (
            <AutomationDetailView
              automation={panel.automation}
              onClose={() => setPanel(null)}
              onDelete={handleDelete}
              onToggleEnabled={handleToggleEnabled}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
