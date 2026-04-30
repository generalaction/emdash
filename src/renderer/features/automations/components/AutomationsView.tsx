import { AnimatePresence, motion } from 'framer-motion';
import { LayoutGrid, Loader2, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Automation, BuiltinAutomationTemplate } from '@shared/automations/types';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { useAutomations } from '../useAutomations';
import { AutomationCard } from './AutomationCard';
import { AutomationRow } from './AutomationRow';
import { AutomationRunsDrawer } from './AutomationRunsDrawer';

export function AutomationsView() {
  const { automations, catalog, remove, setEnabled, runNow } = useAutomations();
  const { toast } = useToast();
  const showConfirmDelete = useShowModal('confirmActionModal');
  const showCreateAutomation = useShowModal('createAutomationModal');
  const [runsAutomation, setRunsAutomation] = useState<Automation | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  const automationItems = useMemo(() => automations.data ?? [], [automations.data]);
  const activeAutomations = useMemo(
    () => automationItems.filter((automation) => automation.enabled),
    [automationItems]
  );
  const pausedAutomations = useMemo(
    () => automationItems.filter((automation) => !automation.enabled),
    [automationItems]
  );
  const usedTemplateIds = useMemo(
    () => new Set(automationItems.map((item) => item.builtinTemplateId).filter(Boolean)),
    [automationItems]
  );
  const recommendedTemplates = useMemo(
    () => (catalog.data ?? []).filter((template) => !usedTemplateIds.has(template.id)),
    [catalog.data, usedTemplateIds]
  );
  const popularTemplates = recommendedTemplates.slice(0, 4);
  const moreTemplates = recommendedTemplates.slice(4);
  const isEmpty = automationItems.length === 0 && recommendedTemplates.length === 0;
  const hasAutomations = automationItems.length > 0;
  const showTemplates = recommendedTemplates.length > 0 && (!hasAutomations || browseOpen);

  function openTemplate(template: BuiltinAutomationTemplate) {
    showCreateAutomation({
      template,
      onSuccess: () => setBrowseOpen(false),
    });
  }

  function openEditAutomation(automation: Automation) {
    showCreateAutomation({ automation });
  }

  function openNewAutomation() {
    showCreateAutomation({});
  }

  function deleteAutomation(automation: Automation) {
    showConfirmDelete({
      title: 'Delete automation',
      description: `“${automation.name}” will be deleted. Run history for this automation will also be removed.`,
      confirmLabel: 'Delete',
      onSuccess: () => remove.mutate(automation.id),
    });
  }

  function runAutomationNow(automation: Automation) {
    runNow.mutate(automation.id, {
      onError: (error) => {
        toast({
          title: 'Automation failed',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      },
    });
  }

  function renderAutomationRow(automation: Automation) {
    return (
      <AutomationRow
        key={automation.id}
        automation={automation}
        busy={runNow.isPending && runNow.variables === automation.id}
        onEdit={openEditAutomation}
        onDelete={deleteAutomation}
        onRunNow={runAutomationNow}
        onSetEnabled={(item, enabled) => setEnabled.mutate({ id: item.id, enabled })}
        onShowRuns={setRunsAutomation}
      />
    );
  }

  const isLoading = automations.isPending || catalog.isPending;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Automations</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Run agents on a schedule or on events from your repo
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasAutomations && recommendedTemplates.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBrowseOpen((prev) => !prev)}
                className="overflow-hidden"
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={browseOpen ? 'close-browse' : 'open-browse'}
                    initial={{ y: 12, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -12, opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="inline-flex items-center"
                  >
                    {browseOpen ? (
                      <>
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Close
                      </>
                    ) : (
                      <>
                        <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
                        Browse Automations
                      </>
                    )}
                  </motion.span>
                </AnimatePresence>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={openNewAutomation}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Automation
            </Button>
          </div>
        </div>

        {automationItems.length > 0 && (
          <div className="mb-6 space-y-5">
            {activeAutomations.length > 0 && (
              <div className="divide-y divide-border/70 border-y border-border/70">
                {activeAutomations.map(renderAutomationRow)}
              </div>
            )}

            {pausedAutomations.length > 0 && (
              <section>
                <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">
                  Paused
                </h2>
                <div className="divide-y divide-border/70 border-y border-border/70">
                  {pausedAutomations.map(renderAutomationRow)}
                </div>
              </section>
            )}
          </div>
        )}

        <AnimatePresence initial={false}>
          {showTemplates && (
            <motion.div
              key="automation-templates"
              initial={{ height: 0, opacity: 0, y: 12 }}
              animate={{ height: 'auto', opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: 6 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <div className="mb-6 space-y-6">
                {popularTemplates.length > 0 && (
                  <section>
                    <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
                      Most popular automations
                    </h2>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {popularTemplates.map((template) => (
                        <AutomationCard
                          key={template.id}
                          kind="template"
                          template={template}
                          onUse={openTemplate}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {moreTemplates.length > 0 && (
                  <section>
                    <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
                      More automation templates
                    </h2>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {moreTemplates.map((template) => (
                        <AutomationCard
                          key={template.id}
                          kind="template"
                          template={template}
                          onUse={openTemplate}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isEmpty && (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">No automations available.</p>
          </div>
        )}
      </div>

      <AutomationRunsDrawer automation={runsAutomation} onClose={() => setRunsAutomation(null)} />
    </div>
  );
}
