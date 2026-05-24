import { CirclePause, CirclePlay, Loader2, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAutomationsTab } from '@renderer/features/automations/automations-view';
import { ListPopoverCard } from '@renderer/lib/components/list-popover-card';
import { useMultiSelect } from '@renderer/lib/hooks/use-multi-select';
import { Button } from '@renderer/lib/ui/button';
import type { Automation } from '@shared/automations/types';
import { useAutomationsActions } from '../use-automations-actions';
import { useAutomationsFilter } from '../use-automations-filter';
import { useAutomationsPanel } from '../use-automations-panel';
import { useAutomations, useRecentAutomationRuns } from '../useAutomations';
import { AutomationPanel, AutomationPanelShell } from './AutomationPanel';
import { AutomationsEmptyState, AutomationsNoResults } from './AutomationsEmptyState';
import { AutomationsHeader } from './AutomationsHeader';
import { AutomationsList } from './AutomationsList';
import { AutomationsSidebarNav } from './AutomationsSidebarNav';
import { RecentRunsList } from './RecentRunsList';

const RECENT_RUNS_VISIBLE_LIMIT = 50;

export function AutomationsView() {
  const { tab, onTabChange } = useAutomationsTab();
  const { automations } = useAutomations();
  const recentRuns = useRecentAutomationRuns(undefined, 200);
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const automationItems = useMemo(() => automations.data ?? [], [automations.data]);
  const {
    panel,
    isOpen: panelOpen,
    selectedAutomationId,
    openEdit,
    openCreate,
    close,
  } = useAutomationsPanel(automationItems);

  const closePanel = useCallback(() => {
    close();
    setSearchExpanded(false);
  }, [close]);

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
  });

  const visibleAutomations = useMemo(
    () => [...filter.drafts, ...filter.active, ...filter.paused],
    [filter.drafts, filter.active, filter.paused]
  );

  const selection = useMultiSelect<Automation>({
    items: visibleAutomations,
    getId: (automation) => automation.id,
  });

  useEffect(() => {
    if (tab !== 'all') selection.clear();
  }, [tab, selection]);

  const selectedAutomations = useMemo(
    () => visibleAutomations.filter((automation) => selection.selectedIds.has(automation.id)),
    [visibleAutomations, selection.selectedIds]
  );
  const selectedCount = selectedAutomations.length;
  const togglableSelected = selectedAutomations.filter((automation) => !automation.isDraft);
  const hasEnabled = togglableSelected.some((automation) => automation.enabled);
  const hasPaused = togglableSelected.some((automation) => !automation.enabled);

  const hasAutomations = automationItems.length > 0;

  useEffect(() => {
    if (panelOpen && searchExpanded) searchInputRef.current?.focus();
  }, [panelOpen, searchExpanded]);

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
    actions.requestBulkSetEnabled(togglableSelected, false, selection.clear);
  };
  const handleBulkResume = () => {
    actions.requestBulkSetEnabled(togglableSelected, true, selection.clear);
  };
  const handleBulkDelete = () => {
    actions.requestBulkDelete(selectedAutomations, selection.clear);
  };

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      <div className="relative z-10 flex min-w-0 flex-1 overflow-hidden">
        <div className="mx-auto grid h-full min-h-0 w-full max-w-[1060px] grid-cols-[13rem_minmax(0,1fr)] gap-8 px-8">
          <div className="py-10">
            <AutomationsSidebarNav tab={tab} onTabChange={onTabChange} />
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
                searchExpanded={searchExpanded}
                onExpandSearch={() => setSearchExpanded(true)}
                onCollapseSearch={() => setSearchExpanded(false)}
                searchInputRef={searchInputRef}
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
                  />
                )
              ) : (
                <section>
                  <RecentRunsList
                    runs={filter.visibleRuns}
                    isPending={recentRuns.isPending}
                    automations={automationItems}
                    searchActive={filter.query.length > 0}
                  />
                </section>
              )}
            </div>

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
            key={panel.kind === 'edit' ? panel.automation.id : 'create'}
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
