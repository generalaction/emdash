import { EmptyState } from '@emdash/ui/react/components';
import {
  CollectionToolbar,
  CollectionView,
  PageLayout,
  useQueryListSource,
} from '@emdash/ui/react/patterns';
import { Button, Sheet, toast } from '@emdash/ui/react/primitives';
import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
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

  const source = useQueryListSource(automations, (rows: Automation[]) => rows);
  const [view] = useState(() => createAutomationsListView(source));

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
                // The slot element is built on every render even though it only
                // shows on error — guard so a null error is never formatted.
                errorSlot={
                  automations.isError ? (
                    <EmptyState
                      bare
                      label="Could not load automations."
                      description={formatAutomationError(automations.error)}
                    />
                  ) : undefined
                }
                emptySlot={
                  hasAutomations ? (
                    <EmptyState bare label="No automations match your search." />
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
