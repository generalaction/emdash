import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { Sheet, SheetContent } from '@renderer/lib/ui/sheet';
import { AutomationsHeader } from './AutomationsHeader';
import { AutomationsList } from './AutomationsList';
import { CreateAutomationView } from './CreateAutomationView';

export function AutomationsView() {
  const { data: automations } = useQuery({
    queryKey: ['automations'],
    queryFn: () => rpc.automations.listAutomations(),
  });
  const [search, setSearch] = useState('');
  const [openNewAutomation, setOpenNewAutomation] = useState(false);

  const handleCreateAutomation = () => {
    setOpenNewAutomation(true);
  };

  return (
    <div className="mt-6 h-full overflow-hidden bg-background text-foreground">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-4xl grid-cols-1 gap-8 px-8">
        <div className="relative min-h-0 w-full min-w-0 overflow-y-auto">
          <div className="w-full py-8">
            <AutomationsHeader
              search={search}
              onSearchChange={setSearch}
              createPending={false}
              onNewAutomation={handleCreateAutomation}
            />
            <AutomationsList automations={automations ?? []} onEdit={() => {}} />
          </div>
        </div>
      </div>
      <Sheet open={openNewAutomation} onOpenChange={setOpenNewAutomation}>
        <SheetContent>
          <CreateAutomationView onClose={() => setOpenNewAutomation(false)} onSaved={() => {}} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
