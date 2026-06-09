import { useMemo, useState } from 'react';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Sheet, SheetContent } from '@renderer/lib/ui/sheet';
import type { Automation } from '@shared/core/automations/automation';
import { useAutomations } from '../use-automations';
import { AutomationDetailView } from './AutomationDetailView';
import { AutomationsHeader } from './AutomationsHeader';
import { AutomationsList } from './AutomationsList';
import { CreateAutomationView } from './CreateAutomationView';

export function AutomationsView() {
  const { automations, toggleEnabled, destroy } = useAutomations();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const showConfirm = useShowModal('confirmActionModal');
  const { navigate } = useNavigate();
  const { params, setParams } = useParams('automations');

  const effectiveAutomations = useMemo(
    () =>
      (automations.data ?? []).filter((a) => a.name.toLowerCase().includes(search.toLowerCase())),
    [automations.data, search]
  );

  const liveAutomation = params.automationId
    ? (automations.data?.find((a) => a.id === params.automationId) ?? null)
    : null;

  function closeSheet() {
    setParams({ automationId: undefined });
    setCreating(false);
  }

  function handleToggleEnabled(automation: Automation, enabled: boolean) {
    void toggleEnabled.mutateAsync({ id: automation.id, enabled });
  }

  function handleDelete(automation: Automation) {
    showConfirm({
      title: 'Delete automation',
      description: `"${automation.name}" will be permanently deleted. Run history will be preserved.`,
      confirmLabel: 'Delete',
      onSuccess: () => {
        void destroy.mutateAsync(automation.id).then(() => closeSheet());
      },
    });
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
              onNewAutomation={() => setCreating(true)}
            />
            <AutomationsList
              automations={effectiveAutomations}
              onEdit={(automation) => navigate('automations', { automationId: automation.id })}
              onToggleEnabled={handleToggleEnabled}
            />
          </div>
        </div>
      </div>
      <Sheet
        open={liveAutomation !== null || creating}
        onOpenChange={(open) => !open && closeSheet()}
      >
        <SheetContent showCloseButton={false}>
          {creating && <CreateAutomationView onClose={closeSheet} onSaved={closeSheet} />}
          {liveAutomation && (
            <AutomationDetailView
              automation={liveAutomation}
              onClose={closeSheet}
              onDelete={handleDelete}
              onToggleEnabled={handleToggleEnabled}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
