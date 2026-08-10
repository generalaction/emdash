import { CollectionToolbar, CollectionView, PageLayout } from '@emdash/ui/react/patterns';
import { Button, Sheet, Spinner, toast } from '@emdash/ui/react/primitives';
import { Plus } from 'lucide-react';
import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useLayoutEffect, useState } from 'react';
import { automationsViewDef } from '@core/features/automations/contributions/views';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { Automation } from '@core/primitives/automations/api';
import { useSearchFocusHotkeys } from '@core/primitives/keybindings/browser';
import {
  useCurrentViewParams,
  useNavigate,
} from '@core/primitives/navigation/browser/navigation-hooks';
import { formatAutomationError } from '../automation-run-format';
import type { BuiltinAutomationTemplate } from '../automation-template';
import {
  createAutomationsListView,
  type AutomationsListViewModel,
} from '../automations-list-model';
import { emptyStateAutomationTemplates } from '../builtin-catalog';
import { useAutomations, useDeleteAutomation, useUpdateAutomation } from '../use-automations';
import { AutomationDetailView } from './AutomationDetailView';
import { AutomationRow } from './AutomationRow';
import { AutomationTemplatesEmptyState } from './AutomationTemplatesEmptyState';
import { CreateAutomationView } from './CreateAutomationView';

export function AutomationsView() {
  const automations = useAutomations();
  const update = useUpdateAutomation();
  const destroy = useDeleteAutomation();
  const [creating, setCreating] = useState(false);
  const [initialTemplate, setInitialTemplate] = useState<BuiltinAutomationTemplate | undefined>();
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null);
  const openConfirm = useOpenModal('confirmActionModal');
  const { navigate } = useNavigate();
  const { params, setParams } = useCurrentViewParams(automationsViewDef);

  // Bridge query data into the view's sync source: seed the box so the first
  // render sees data, and update before paint to avoid an empty flash.
  const [itemsBox] = useState(() =>
    observable.box<Automation[]>(automations.data ?? [], { deep: false })
  );
  const [view] = useState(() => createAutomationsListView(() => itemsBox.get()));
  useLayoutEffect(() => {
    runInAction(() => itemsBox.set(automations.data ?? []));
  }, [automations.data, itemsBox]);

  const hasAutomations = (automations.data?.length ?? 0) > 0;

  const liveAutomation = params.automationId
    ? (automations.data?.find((a) => a.id === params.automationId) ?? null)
    : null;

  function closeSheet() {
    setParams({ automationId: undefined });
    setCreating(false);
    setInitialTemplate(undefined);
  }

  function openCreateSheet(template?: BuiltinAutomationTemplate) {
    setInitialTemplate(template);
    setCreating(true);
  }

  function handleToggleEnabled(automation: Automation, enabled: boolean) {
    void update.mutateAsync({ id: automation.id, patch: { enabled } });
  }

  function handleDelete(automation: Automation) {
    setPendingDelete(automation);
    closeSheet();
  }

  function handleSheetOpenChangeComplete(open: boolean) {
    if (open || !pendingDelete) return;

    // The sheet is modal and makes sibling portals inert. Wait until it has fully closed before
    // opening the global confirmation dialog so that the dialog remains interactive.
    const automation = pendingDelete;
    setPendingDelete(null);
    void openConfirm({
      title: 'Delete automation',
      description: `"${automation.name}" and its run history will be permanently deleted.`,
      confirmLabel: 'Delete',
    }).then((outcome) => {
      if (outcome.success) {
        void destroy.mutateAsync(automation.id).catch((error) => {
          setParams({ automationId: automation.id });
          toast.error('Could not delete automation', {
            description: formatAutomationError(error),
          });
        });
      } else if (outcome.error.reason === 'explicit') {
        setParams({ automationId: automation.id });
      }
    });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <div className="h-6 shrink-0 [-webkit-app-region:drag]" />
      <div className="mx-auto grid min-h-0 w-full max-w-4xl flex-1 grid-cols-1 gap-8">
        <div className="relative min-h-0 w-full min-w-0 overflow-y-auto px-8">
          <div className="flex w-full flex-col gap-4 py-8">
            <PageLayout.Header
              title="Automations"
              description="Run agents on a schedule across your projects"
            />
            <view.Root>
              <CollectionView
                view={view}
                renderRow={(automation) => (
                  <AutomationRow
                    automation={automation}
                    onToggleEnabled={(enabled) => handleToggleEnabled(automation, enabled)}
                  />
                )}
                estimateSize={68}
                toolbar={
                  <AutomationsToolbar view={view} onNewAutomation={() => openCreateSheet()} />
                }
                onItemClick={(automation) =>
                  navigate(automationsViewDef({ automationId: automation.id }))
                }
                emptySlot={
                  automations.isPending ? (
                    <AutomationsLoadingState />
                  ) : hasAutomations ? (
                    <div className="p-8 text-center text-sm text-foreground-muted">
                      No automations match your search.
                    </div>
                  ) : (
                    <AutomationTemplatesEmptyState
                      templates={emptyStateAutomationTemplates}
                      onSelectTemplate={openCreateSheet}
                    />
                  )
                }
              />
            </view.Root>
          </div>
        </div>
      </div>
      <Sheet.Root
        open={liveAutomation !== null || creating}
        onOpenChange={(open) => !open && closeSheet()}
        onOpenChangeComplete={handleSheetOpenChangeComplete}
      >
        <Sheet.Content className="[-webkit-app-region:no-drag]">
          {creating && (
            <CreateAutomationView
              onClose={closeSheet}
              onSaved={closeSheet}
              initialTemplate={initialTemplate}
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
        </Sheet.Content>
      </Sheet.Root>
    </div>
  );
}

const AutomationsToolbar = observer(function AutomationsToolbar({
  view,
  onNewAutomation,
}: {
  view: AutomationsListViewModel;
  onNewAutomation: () => void;
}) {
  const search = view.useSearch();
  const searchRef = useSearchFocusHotkeys();
  return (
    <CollectionToolbar
      ref={searchRef}
      searchValue={search.query}
      onSearchValueChange={search.setQuery}
      searchPlaceholder="Search automations…"
      actions={
        <Button variant="primary" className="shrink-0 whitespace-nowrap" onClick={onNewAutomation}>
          <Plus className="h-3.5 w-3.5" />
          New Automation
        </Button>
      }
    />
  );
});

// The view's sync source is never "loading", so the query's pending state
// routes through the empty slot rather than CollectionView's loadingSlot.
function AutomationsLoadingState() {
  return (
    <div className="flex min-h-48 items-center justify-center p-8">
      <Spinner />
    </div>
  );
}
