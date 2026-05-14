import { Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatAutomationError } from '@shared/automations/format';
import type { Automation } from '@shared/automations/types';
import { firstMountedProjectId } from '@renderer/features/projects/stores/project-selectors';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { useAutomations } from '../useAutomations';
import { AutomationPanel, AutomationPanelShell } from './AutomationPanel';
import { AutomationRow } from './AutomationRow';
import { RecentRunsList } from './RecentRunsList';

type PanelState = { kind: 'create' } | { kind: 'edit'; automation: Automation } | null;

export function AutomationsView() {
  const { automations, create, remove, setEnabled, runNow } = useAutomations();
  const { toast } = useToast();
  const showConfirmDelete = useShowModal('confirmActionModal');
  const [panel, setPanel] = useState<PanelState>(null);
  const [search, setSearch] = useState('');

  const automationItems = useMemo(() => automations.data ?? [], [automations.data]);
  const filteredAutomations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return automationItems;
    return automationItems.filter((automation) => automation.name.toLowerCase().includes(query));
  }, [automationItems, search]);
  const draftAutomations = useMemo(
    () => filteredAutomations.filter((automation) => automation.isDraft),
    [filteredAutomations]
  );
  const activeAutomations = useMemo(
    () => filteredAutomations.filter((automation) => !automation.isDraft && automation.enabled),
    [filteredAutomations]
  );
  const pausedAutomations = useMemo(
    () => filteredAutomations.filter((automation) => !automation.isDraft && !automation.enabled),
    [filteredAutomations]
  );
  const hasAutomations = automationItems.length > 0;
  const hasResults = filteredAutomations.length > 0;
  const panelOpen = panel !== null;
  const selectedAutomationId = panel?.kind === 'edit' ? panel.automation.id : null;

  function closePanel() {
    setPanel(null);
  }

  useEffect(() => {
    if (!panelOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], [data-radix-popper-content-wrapper]')) return;
      event.preventDefault();
      closePanel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panelOpen]);

  function openEditAutomation(automation: Automation) {
    setPanel({ kind: 'edit', automation });
  }

  function openNewAutomation() {
    const projectId = firstMountedProjectId();
    if (!projectId) {
      toast({
        title: 'No project available',
        description: 'Add or mount a project before creating an automation.',
        variant: 'destructive',
      });
      return;
    }
    setPanel({ kind: 'create' });
  }

  function handleDelete(automation: Automation) {
    showConfirmDelete({
      title: 'Delete automation',
      description: `“${automation.name}” will be deleted. Run history for this automation will also be removed.`,
      confirmLabel: 'Delete',
      onSuccess: () =>
        remove.mutate(automation.id, {
          onSuccess: () => {
            if (selectedAutomationId === automation.id) closePanel();
          },
        }),
    });
  }

  function handleRunNow(automation: Automation) {
    if (automation.isDraft) return;
    runNow.mutate(automation.id, {
      onError: (error) => {
        toast({
          title: 'Automation failed',
          description: formatAutomationError(error),
          variant: 'destructive',
        });
      },
    });
  }

  function handleToggleEnabled(automation: Automation, enabled: boolean) {
    if (automation.isDraft) return;
    setEnabled.mutate({ id: automation.id, enabled });
  }

  function handleSaved(automation: Automation) {
    if (panel?.kind === 'create') {
      closePanel();
      return;
    }
    setPanel({ kind: 'edit', automation });
  }

  function renderAutomationRow(automation: Automation) {
    return (
      <AutomationRow
        key={automation.id}
        automation={automation}
        busy={runNow.isPending && runNow.variables === automation.id}
        onEdit={openEditAutomation}
        onDelete={handleDelete}
        onRunNow={handleRunNow}
        onSetEnabled={handleToggleEnabled}
        onShowRuns={openEditAutomation}
      />
    );
  }

  const isLoading = automations.isPending;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">Automations</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Run agents on a schedule across your projects
              </p>
            </div>

            {hasAutomations && (
              <div className="flex min-w-0 shrink-0 items-center gap-2">
                <SearchInput
                  placeholder="Search automations..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-64"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={create.isPending}
                  onClick={openNewAutomation}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  New Automation
                </Button>
              </div>
            )}
          </div>

          {hasAutomations ? (
            hasResults ? (
              <div className="mb-6 space-y-5">
                {draftAutomations.length > 0 && (
                  <section>
                    <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">
                      Drafts
                    </h2>
                    <div>{draftAutomations.map(renderAutomationRow)}</div>
                  </section>
                )}

                {activeAutomations.length > 0 && (
                  <section>
                    <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">
                      Active
                    </h2>
                    <div>{activeAutomations.map(renderAutomationRow)}</div>
                  </section>
                )}

                {pausedAutomations.length > 0 && (
                  <section>
                    <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">
                      Paused
                    </h2>
                    <div>{pausedAutomations.map(renderAutomationRow)}</div>
                  </section>
                )}
              </div>
            ) : (
              <div className="mb-6 py-12 text-center">
                <p className="text-sm text-muted-foreground">No automations match your search.</p>
              </div>
            )
          ) : (
            <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No automations yet. Use a template or start from scratch.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={create.isPending}
                onClick={openNewAutomation}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New Automation
              </Button>
            </div>
          )}

          {hasAutomations && (
            <section className="mt-2">
              <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">
                Recent runs
              </h2>
              <RecentRunsList />
            </section>
          )}
        </div>
      </div>

      <AutomationPanelShell open={panelOpen}>
        {panel ? (
          <AutomationPanel
            key={panel.kind === 'edit' ? panel.automation.id : 'create'}
            mode={panel}
            onClose={closePanel}
            onSaved={handleSaved}
            onDelete={handleDelete}
            onRunNow={handleRunNow}
            onToggleEnabled={handleToggleEnabled}
            runNowPending={
              panel.kind === 'edit' && runNow.isPending && runNow.variables === panel.automation.id
            }
          />
        ) : null}
      </AutomationPanelShell>
    </div>
  );
}
