import { useMemo, useState } from 'react';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Sheet, SheetContent } from '@renderer/lib/ui/sheet';
import type { Automation, BuiltinAutomationTemplate } from '@shared/automations/automation';
import { useAutomations } from '../use-automations';
import { AutomationDetailView } from './AutomationDetailView';
import { AutomationsHeader } from './AutomationsHeader';
import { AutomationsList } from './AutomationsList';
import { AutomationTemplateGallery } from './AutomationTemplateGallery';
import { CreateAutomationView } from './CreateAutomationView';

type SheetState =
  | { kind: 'create'; template: BuiltinAutomationTemplate | null }
  | { kind: 'edit'; automationId: string }
  | null;

export function AutomationsView() {
  const { automations, toggleEnabled, destroy } = useAutomations();
  const [search, setSearch] = useState('');
  const [sheetState, setSheetState] = useState<SheetState>(null);
  const showConfirm = useShowModal('confirmActionModal');
  const { navigate } = useNavigate();
  const { params, setParams } = useParams('automations');

  const effectiveAutomations = useMemo(
    () =>
      (automations.data ?? []).filter((a) => a.name.toLowerCase().includes(search.toLowerCase())),
    [automations.data, search]
  );

  const hasAutomations = (automations.data?.length ?? 0) > 0;

  const sheetAutomationId =
    sheetState?.kind === 'edit' ? sheetState.automationId : params.automationId;
  const liveAutomation =
    sheetState?.kind === 'create'
      ? null
      : sheetAutomationId
        ? (automations.data?.find((a) => a.id === sheetAutomationId) ?? null)
        : null;

  function openCreate(template: BuiltinAutomationTemplate | null) {
    setParams({ automationId: undefined });
    setSheetState({ kind: 'create', template });
  }

  function openEdit(automation: Automation) {
    setSheetState({ kind: 'edit', automationId: automation.id });
    navigate('automations', { automationId: automation.id });
  }

  function closeSheet() {
    setParams({ automationId: undefined });
    setSheetState(null);
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
              onNewAutomation={() => openCreate(null)}
            />
            {hasAutomations && effectiveAutomations.length === 0 ? (
              <EmptyState
                label="No matches"
                description="No automations match your search."
                className="min-h-32 py-8"
              />
            ) : (
              <AutomationsList
                automations={effectiveAutomations}
                onEdit={openEdit}
                onToggleEnabled={handleToggleEnabled}
              />
            )}
            {!hasAutomations && automations.isSuccess && (
              <EmptyState
                label="No automations yet"
                description="Run agents on a schedule. Start from a template below or create your own."
                className="min-h-32 py-8"
              />
            )}
            <div className="mt-8">
              <AutomationTemplateGallery onSelectTemplate={(template) => openCreate(template)} />
            </div>
          </div>
        </div>
      </div>
      <Sheet
        open={liveAutomation !== null || sheetState?.kind === 'create'}
        onOpenChange={(open) => !open && closeSheet()}
      >
        <SheetContent showCloseButton={false}>
          {sheetState?.kind === 'create' && (
            <CreateAutomationView
              key={sheetState.template?.id ?? 'scratch'}
              template={sheetState.template ?? undefined}
              onClose={closeSheet}
              onSaved={closeSheet}
            />
          )}
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
