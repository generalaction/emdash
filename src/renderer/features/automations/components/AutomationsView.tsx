import { Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useAutomationsContext } from '@renderer/features/automations/automations-context';
import { useAutomationsTab } from '@renderer/features/automations/automations-view';
import { Sheet, SheetContent } from '@renderer/lib/ui/sheet';
import { EMPTY_AUTOMATION_RUNS_FACET_FILTERS } from '../automation-runs-filter-types';
import { useAutomationsActions } from '../use-automations-actions';
import { useAutomationsFilter } from '../use-automations-filter';
import { useAutomationsPanel } from '../use-automations-panel';
import { AutomationDetailView } from './AutomationDetailView';
import { AutomationsEmptyState, AutomationsNoResults } from './AutomationsEmptyState';
import { AutomationsHeader } from './AutomationsHeader';
import { AutomationsList } from './AutomationsList';
import { CreateAutomationView } from './CreateAutomationView';

const RECENT_RUNS_VISIBLE_LIMIT = 50;

export function AutomationsView() {
  const { tab, onTabChange } = useAutomationsTab();
  const {
    automations: automationItems,
    automationsIsPending,
    recentRuns,
  } = useAutomationsContext();
  const [search, setSearch] = useState('');
  const [runFacetFilters, setRunFacetFilters] = useState(EMPTY_AUTOMATION_RUNS_FACET_FILTERS);

  const { panel, selectedAutomationId, openEdit, openCreate, openCreateWithTemplate, close } =
    useAutomationsPanel(automationItems);

  const closePanel = useCallback(() => close(), [close]);

  const actions = useAutomationsActions({
    selectedAutomationId,
    onPanelClose: closePanel,
    onRequestCreate: openCreate,
  });
  const filter = useAutomationsFilter({
    automations: automationItems,
    runs: recentRuns.data,
    search,
    runsVisibleLimit: RECENT_RUNS_VISIBLE_LIMIT,
    runFacetFilters: tab === 'runs' ? runFacetFilters : undefined,
  });

  const filteredAutomations = useMemo(
    () => [...filter.drafts, ...filter.active, ...filter.paused],
    [filter.drafts, filter.active, filter.paused]
  );

  if (automationsIsPending) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  const hasAutomations = automationItems.length > 0;
  const searchPlaceholder = tab === 'runs' ? 'Search runs...' : 'Search automations...';
  const headerTitle = tab === 'runs' ? 'Recent Runs' : 'Automations';
  const headerSubtitle =
    tab === 'runs'
      ? 'Activity across all automations'
      : 'Run agents on a schedule across your projects';

  return (
    <div className="mt-6 h-full overflow-hidden bg-background text-foreground">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-4xl grid-cols-1 gap-8 px-8">
        <div className="relative min-h-0 w-full min-w-0 overflow-y-auto">
          <div className="w-full py-8">
            <AutomationsHeader
              title={headerTitle}
              subtitle={headerSubtitle}
              showActions={hasAutomations}
              showNewButton={tab === 'all'}
              panelOpen={panel !== null}
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder={searchPlaceholder}
              createPending={actions.createPending}
              onNewAutomation={actions.requestCreate}
            />

            {hasAutomations ? (
              filter.hasResults ? (
                <AutomationsList automations={filteredAutomations} onEdit={openEdit} />
              ) : (
                <AutomationsNoResults />
              )
            ) : (
              <AutomationsEmptyState
                createPending={actions.createPending}
                onNewAutomation={actions.requestCreate}
                onSelectTemplate={openCreateWithTemplate}
              />
            )}
          </div>
        </div>
      </div>

      {/* Detail sheet — opens when editing an existing automation */}
      <Sheet
        open={panel?.kind === 'edit'}
        onOpenChange={(open) => {
          if (!open) closePanel();
        }}
      >
        <SheetContent side="right" showCloseButton={false} className="p-0">
          {panel?.kind === 'edit' && (
            <AutomationDetailView
              key={panel.automation.id}
              automation={panel.automation}
              onClose={closePanel}
              onDelete={actions.requestDelete}
              onRunNow={actions.requestRunNow}
              onToggleEnabled={actions.requestToggleEnabled}
              runNowPending={
                actions.runNowState.isPending &&
                actions.runNowState.variables === panel.automation.id
              }
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Create sheet — opens when creating a new automation */}
      <Sheet
        open={panel?.kind === 'create'}
        onOpenChange={(open) => {
          if (!open) closePanel();
        }}
      >
        <SheetContent side="right" showCloseButton={false} className="p-0">
          {panel?.kind === 'create' && (
            <CreateAutomationView
              key={panel.template?.id ?? 'create'}
              template={panel.template}
              onClose={closePanel}
              onSaved={closePanel}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
