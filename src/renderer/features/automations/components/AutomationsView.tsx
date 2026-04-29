import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Automation, BuiltinAutomationTemplate } from '@shared/automations/types';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { useAutomations } from '../useAutomations';
import { AutomationCard } from './AutomationCard';
import { AutomationRow } from './AutomationRow';
import { AutomationRunsDrawer } from './AutomationRunsDrawer';
import { CreateAutomationPanel } from './CreateAutomationPanel';

type PanelSeed =
  | { kind: 'new' }
  | { kind: 'template'; template: BuiltinAutomationTemplate }
  | { kind: 'edit'; automation: Automation };

export function AutomationsView() {
  const { automations, catalog, remove, setEnabled, runNow } = useAutomations();
  const showConfirmDelete = useShowModal('confirmActionModal');
  const [runsAutomation, setRunsAutomation] = useState<Automation | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelSeed, setPanelSeed] = useState<PanelSeed>({ kind: 'new' });

  const automationItems = automations.data ?? [];
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

  function openTemplate(template: BuiltinAutomationTemplate) {
    setPanelSeed({ kind: 'template', template });
    setPanelOpen(true);
  }

  function openEditAutomation(automation: Automation) {
    setPanelSeed({ kind: 'edit', automation });
    setPanelOpen(true);
  }

  function openNewPanel() {
    setPanelSeed({ kind: 'new' });
    setPanelOpen(true);
  }

  useEffect(() => {
    if (!panelOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setPanelOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  function deleteAutomation(automation: Automation) {
    showConfirmDelete({
      title: 'Delete automation',
      description: `“${automation.name}” will be deleted. Run history for this automation will also be removed.`,
      confirmLabel: 'Delete',
      onSuccess: () => remove.mutate(automation.id),
    });
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => (panelOpen ? setPanelOpen(false) : openNewPanel())}
            className="overflow-hidden"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={panelOpen ? 'close' : 'open'}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="inline-flex items-center"
              >
                {panelOpen ? (
                  <>
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    Close
                  </>
                ) : (
                  <>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    New Automation
                  </>
                )}
              </motion.span>
            </AnimatePresence>
          </Button>
        </div>

        <CreateAutomationPanel
          open={panelOpen}
          onOpenChange={setPanelOpen}
          template={panelSeed.kind === 'template' ? panelSeed.template : undefined}
          automation={panelSeed.kind === 'edit' ? panelSeed.automation : undefined}
        />

        {automationItems.length > 0 && (
          <div className="mb-6 overflow-hidden rounded-lg border border-border bg-muted/10">
            {automationItems.map((automation) => (
              <AutomationRow
                key={automation.id}
                automation={automation}
                busy={runNow.isPending}
                onEdit={openEditAutomation}
                onDelete={deleteAutomation}
                onRunNow={(item) => runNow.mutate(item.id)}
                onSetEnabled={(item, enabled) => setEnabled.mutate({ id: item.id, enabled })}
                onShowRuns={setRunsAutomation}
              />
            ))}
          </div>
        )}

        {recommendedTemplates.length > 0 && (
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
        )}

        {isEmpty && (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">No automations available.</p>
          </div>
        )}
      </div>

      {runsAutomation && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/10"
            aria-label="Close run history"
            onClick={() => setRunsAutomation(null)}
          />
          <AutomationRunsDrawer
            automation={runsAutomation}
            onClose={() => setRunsAutomation(null)}
          />
        </>
      )}
    </div>
  );
}
