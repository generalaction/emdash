import { CirclePause, CirclePlay, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAutomationsTab } from '@renderer/features/automations/automations-view';
import { ListPopoverCard } from '@renderer/lib/components/list-popover-card';
import { useMultiSelect } from '@renderer/lib/hooks/use-multi-select';
import { Button } from '@renderer/lib/ui/button';
import type { Automation, AutomationRunWithContext } from '@shared/automations/types';
import { EMPTY_AUTOMATION_RUNS_FACET_FILTERS } from '../automation-runs-filter-types';
import { useAutomationRunActions } from '../use-automation-run-actions';
import { useAutomationsActions } from '../use-automations-actions';
import { useAutomationsFilter } from '../use-automations-filter';
import { useAutomationsPanel } from '../use-automations-panel';
import { useAutomations, useRecentAutomationRuns } from '../useAutomations';
import { AutomationRunsFilterBar } from './automation-runs-filter-bar';
import { AutomationPanel } from './AutomationPanel';
import { AutomationPanelShell } from './AutomationPanelShell';
import { AutomationsEmptyState, AutomationsNoResults } from './AutomationsEmptyState';
import { AutomationsHeader } from './AutomationsHeader';
import { AutomationsList } from './AutomationsList';
import { AutomationsSidebarNav } from './AutomationsSidebarNav';
import { RecentRunsList } from './RecentRunsList';

const RECENT_RUNS_VISIBLE_LIMIT = 50;
const EMPTY_VISIBLE_RUNS: AutomationRunWithContext[] = [];

export function AutomationsView() {
  const { tab, onTabChange } = useAutomationsTab();
  const { automations } = useAutomations();
  const recentRuns = useRecentAutomationRuns(undefined, 200);
  const [search, setSearch] = useState('');
  const [runFacetFilters, setRunFacetFilters] = useState(EMPTY_AUTOMATION_RUNS_FACET_FILTERS);

  const automationItems = useMemo(() => automations.data ?? [], [automations.data]);
  const {
    panel,
    isOpen: panelOpen,
    selectedAutomationId,
    openEdit,
    openCreate,
    openCreateWithTemplate,
    close,
  } = useAutomationsPanel(automationItems);

  const closePanel = useCallback(() => {
    close();
  }, [close]);

  const actions = useAutomationsActions({
    selectedAutomationId,
    onPanelClose: closePanel,
    onRequestCreate: openCreate,
  });
  const runActions = useAutomationRunActions();

  const filter = useAutomationsFilter({
    automations: automationItems,
    runs: recentRuns.data,
    search,
    runsVisibleLimit: RECENT_RUNS_VISIBLE_LIMIT,
    runFacetFilters: tab === 'runs' ? runFacetFilters : undefined,
  });

  const visibleAutomations = useMemo(
    () => [...filter.drafts, ...filter.active, ...filter.paused],
    [filter.drafts, filter.active, filter.paused]
  );

  const selection = useMultiSelect<Automation>({
    items: visibleAutomations,
    getId: (automation) => automation.id,
  });
  const clearSelection = selection.clear;

  const visibleRuns = filter.visibleRuns ?? EMPTY_VISIBLE_RUNS;
  const runSelection = useMultiSelect<AutomationRunWithContext>({
    items: visibleRuns,
    getId: (run) => run.id,
  });
  const clearRunSelection = runSelection.clear;

  const handleTabChange = useCallback(
    (nextTab: typeof tab) => {
      if (nextTab !== 'all') clearSelection();
      if (nextTab !== 'runs') clearRunSelection();
      if (nextTab !== 'runs') setRunFacetFilters(EMPTY_AUTOMATION_RUNS_FACET_FILTERS);
      onTabChange(nextTab);
    },
    [onTabChange, clearSelection, clearRunSelection]
  );

  const selectedAutomations = useMemo(
    () => visibleAutomations.filter((automation) => selection.selectedIds.has(automation.id)),
    [visibleAutomations, selection.selectedIds]
  );
  const selectedCount = selectedAutomations.length;
  const togglableSelected = selectedAutomations.filter((automation) => !automation.isDraft);
  const hasEnabled = togglableSelected.some((automation) => automation.enabled);
  const hasPaused = togglableSelected.some((automation) => !automation.enabled);

  const automationById = useMemo(() => {
    const map = new Map<string, Automation>();
    for (const automation of automationItems) {
      map.set(automation.id, automation);
    }
    return map;
  }, [automationItems]);

  const selectedRuns = useMemo(
    () => visibleRuns.filter((run) => runSelection.selectedIds.has(run.id)),
    [visibleRuns, runSelection.selectedIds]
  );
  const selectedRunCount = selectedRuns.length;
  const rerunnableSelectedRuns = useMemo(
    () =>
      selectedRuns.filter((run) => {
        const automation = automationById.get(run.automationId);
        return automation && !automation.isDraft && automation.projectId;
      }),
    [selectedRuns, automationById]
  );

  const hasAutomations = automationItems.length > 0;

  useEffect(() => {
    if (!panelOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], [data-radix-popper-content-wrapper]')) return;
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panelOpen, closePanel]);

  function handleSaved() {
    closePanel();
  }

  if (automations.isPending) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  const searchPlaceholder = tab === 'runs' ? 'Search runs...' : 'Search automations...';
  const headerTitle = tab === 'runs' ? 'Recent Runs' : 'Automations';
  const headerSubtitle =
    tab === 'runs'
      ? 'Activity across all automations'
      : 'Run agents on a schedule across your projects';

  const handleBulkPause = () => {
    void actions.requestBulkSetEnabled(togglableSelected, false, selection.clear);
  };
  const handleBulkResume = () => {
    void actions.requestBulkSetEnabled(togglableSelected, true, selection.clear);
  };
  const handleBulkDelete = () => {
    actions.requestBulkDelete(selectedAutomations, selection.clear);
  };

  const handleBulkDeleteRuns = () => {
    runActions.bulkDeleteRuns(
      selectedRuns.map((run) => run.id),
      runSelection.clear
    );
  };

  const handleBulkRerunRuns = () => {
    const seen = new Set<string>();
    for (const run of rerunnableSelectedRuns) {
      if (seen.has(run.automationId)) continue;
      seen.add(run.automationId);
      runActions.rerunFrom(run.automationId);
    }
    runSelection.clear();
  };

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      <div className="relative z-10 flex min-w-0 flex-1 overflow-hidden">
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
                    <AutomationsList
                      drafts={filter.drafts}
                      active={filter.active}
                      paused={filter.paused}
                      runsByAutomation={filter.runsByAutomation}
                      onEdit={openEdit}
                      onRunNow={actions.requestRunNow}
                      onToggleEnabled={actions.requestToggleEnabled}
                      onCopy={actions.requestCopy}
                      onDelete={actions.requestDelete}
                      isSelected={selection.isSelected}
                      onToggleSelect={selection.toggle}
                    />
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
                    isSelected={runSelection.isSelected}
                    onToggleSelect={runSelection.toggle}
                  />
                </section>
              )}
            </div>

            {tab === 'runs' && selectedRunCount > 0 ? (
              <ListPopoverCard className="justify-between">
                <span className="whitespace-nowrap text-foreground-muted">
                  {selectedRunCount} selected
                </span>
                <div className="flex items-center gap-2">
                  {rerunnableSelectedRuns.length > 0 ? (
                    <Button variant="outline" size="sm" onClick={handleBulkRerunRuns}>
                      <RotateCcw className="size-3.5" />
                      Rerun
                    </Button>
                  ) : null}
                  <Button variant="destructive" size="sm" onClick={handleBulkDeleteRuns}>
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={runSelection.clear}
                    aria-label="Clear selection"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              </ListPopoverCard>
            ) : null}

            {tab === 'all' && selectedCount > 0 ? (
              <ListPopoverCard className="justify-between">
                <span className="whitespace-nowrap text-foreground-muted">
                  {selectedCount} selected
                </span>
                <div className="flex items-center gap-2">
                  {hasEnabled ? (
                    <Button variant="outline" size="sm" onClick={handleBulkPause}>
                      <CirclePause className="size-3.5" />
                      Pause
                    </Button>
                  ) : null}
                  {hasPaused ? (
                    <Button variant="outline" size="sm" onClick={handleBulkResume}>
                      <CirclePlay className="size-3.5" />
                      Resume
                    </Button>
                  ) : null}
                  <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={selection.clear}
                    aria-label="Clear selection"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              </ListPopoverCard>
            ) : null}
          </div>
        </div>
      </div>

      <AutomationPanelShell open={panelOpen}>
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
      </AutomationPanelShell>
    </div>
  );
}
