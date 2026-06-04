import { Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useAutomationsContext } from '@renderer/features/automations/automations-context';
import { useAutomationsTab } from '@renderer/features/automations/automations-view';
import { Sheet, SheetContent } from '@renderer/lib/ui/sheet';
import { EMPTY_AUTOMATION_RUNS_FACET_FILTERS } from '../automation-runs-filter-types';
import { useAutomationsActions } from '../use-automations-actions';
import { useAutomationsFilter } from '../use-automations-filter';
import { useAutomationsPanel } from '../use-automations-panel';
import { AutomationRunsFilterBar } from './automation-runs-filter-bar';
import { AutomationPanel } from './AutomationPanel';
import { AutomationsEmptyState, AutomationsNoResults } from './AutomationsEmptyState';
import { AutomationsHeader } from './AutomationsHeader';
import { AutomationsList } from './AutomationsList';
import { AutomationsSidebarNav } from './AutomationsSidebarNav';
import { RecentRunsList } from './RecentRunsList';

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

  const {
    panel,
    isOpen: panelOpen,
    selectedAutomationId,
    openEdit,
    openCreate,
    openCreateWithTemplate,
    close,
  } = useAutomationsPanel(automationItems);

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

  const handleTabChange = useCallback(
    (nextTab: typeof tab) => {
      if (nextTab !== 'runs') setRunFacetFilters(EMPTY_AUTOMATION_RUNS_FACET_FILTERS);
      onTabChange(nextTab);
    },
    [onTabChange]
  );

  function handleSaved() {
    closePanel();
  }

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
    <div className="h-full overflow-hidden bg-background text-foreground">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-[1060px] grid-cols-[13rem_minmax(0,1fr)] gap-8 px-8">
        <div className="py-10">
          <AutomationsSidebarNav tab={tab} onTabChange={handleTabChange} />
        </div>

        <div className="relative min-h-0 min-w-0 overflow-y-auto">
          <div className="w-full py-8">
            <AutomationsHeader
              title={headerTitle}
              subtitle={headerSubtitle}
              showActions={hasAutomations}
              showNewButton={tab === 'all'}
              panelOpen={panelOpen}
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder={searchPlaceholder}
              createPending={actions.createPending}
              onNewAutomation={actions.requestCreate}
            />

            {tab === 'all' ? (
              hasAutomations ? (
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
              )
            ) : (
              <section>
                <AutomationRunsFilterBar
                  filters={runFacetFilters}
                  options={filter.runsFilterOptions}
                  onChange={setRunFacetFilters}
                />
                <RecentRunsList
                  runs={filter.visibleRuns}
                  isPending={recentRuns.isPending}
                  automations={automationItems}
                  filtersActive={filter.query.length > 0 || filter.hasRunFacetFilters}
                />
              </section>
            )}
          </div>
        </div>
      </div>

      <Sheet
        open={panelOpen}
        onOpenChange={(open) => {
          if (!open) closePanel();
        }}
      >
        <SheetContent side="right" showCloseButton={false} className="p-0 sm:max-w-[480px]">
          {panel ? (
            <AutomationPanel
              key={panel.kind === 'edit' ? panel.automation.id : (panel.template?.id ?? 'create')}
              mode={panel}
              onClose={closePanel}
              onSaved={handleSaved}
              onDelete={actions.requestDelete}
              onRunNow={actions.requestRunNow}
              onToggleEnabled={actions.requestToggleEnabled}
              runNowPending={
                panel.kind === 'edit' &&
                actions.runNowState.isPending &&
                actions.runNowState.variables === panel.automation.id
              }
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
