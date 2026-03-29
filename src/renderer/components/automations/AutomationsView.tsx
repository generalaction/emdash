import React, { useState } from 'react';
import { Plus, Loader2, X, LayoutGrid } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '../ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import AutomationRow from './AutomationRow';
import { TooltipProvider } from '../ui/tooltip';
import AutomationInlineCreate from './AutomationInlineCreate';
import AutomationRunningTasks from './AutomationRunningTasks';
import ExampleAutomations, { TemplatesDialog } from './ExampleAutomations';
import RunLogsModal from './RunLogsModal';
import { useAutomations } from './useAutomations';
import { useProjectManagementContext } from '../../contexts/ProjectManagementProvider';
import type {
  Automation,
  AutomationMode,
  TriggerType,
  UpdateAutomationInput,
} from '@shared/automations/types';
import { useIntegrationStatusMap } from '../../hooks/useIntegrationStatusMap';

const AutomationsView: React.FC = () => {
  const {
    automations,
    isLoading,
    error,
    clearError,
    refresh,
    create,
    update,
    remove,
    toggle,
    getRunLogs,
    triggerNow,
  } = useAutomations();

  const { projects } = useProjectManagementContext();
  const { statuses: integrationStatuses } = useIntegrationStatusMap();

  const [showCreate, setShowCreate] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [logsAutomation, setLogsAutomation] = useState<Automation | null>(null);
  const [prefill, setPrefill] = useState<{
    name: string;
    prompt: string;
    mode?: AutomationMode;
    triggerType?: TriggerType;
  } | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const handleEdit = (automation: Automation) => {
    setShowCreate(false);
    setPrefill(null);
    setEditingAutomation(automation);
  };

  const handleUpdate = async (input: UpdateAutomationInput) => {
    const result = await update(input);
    if (result) {
      setEditingAutomation(null);
    }
  };

  const handleDelete = async () => {
    if (deleteTarget) {
      await remove(deleteTarget);
      setDeleteTarget(null);
    }
  };

  const handleExampleClick = (
    name: string,
    prompt: string,
    mode?: AutomationMode,
    triggerType?: TriggerType
  ) => {
    setEditingAutomation(null);
    setPrefill({ name, prompt, mode, triggerType });
    setShowCreate(true);
  };

  const activeAutomations = automations.filter((a) => a.status === 'active');
  const pausedAutomations = automations.filter((a) => a.status !== 'active');
  const hasAutomations = automations.length > 0;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
        <div className="mx-auto w-full max-w-3xl px-8 py-8">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="text-lg font-semibold">Automations</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Trigger automations from GitHub events, Linear tickets, or run them on a schedule
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowTemplates(true)}>
                <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
                Browse Templates
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPrefill(null);
                  setEditingAutomation(null);
                  setShowCreate(true);
                }}
                disabled={showCreate}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New Automation
              </Button>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-4 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-xs text-destructive">{error}</p>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-5 w-5 text-destructive/60 hover:text-destructive"
                onClick={clearError}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Inline Create */}
          <AnimatePresence>
            {showCreate && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                className="overflow-hidden"
              >
                <AutomationInlineCreate
                  projects={projects}
                  prefill={prefill}
                  onSave={async (input) => {
                    const result = await create(input);
                    if (result) {
                      setShowCreate(false);
                      setPrefill(null);
                    }
                  }}
                  onCancel={() => {
                    setShowCreate(false);
                    setPrefill(null);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Inline Edit */}
          <AnimatePresence>
            {editingAutomation && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                className="overflow-hidden"
              >
                <AutomationInlineCreate
                  key={editingAutomation.id}
                  projects={projects}
                  editingAutomation={editingAutomation}
                  onSave={async () => {}}
                  onUpdate={handleUpdate}
                  onCancel={() => setEditingAutomation(null)}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Empty state with inline templates */}
          {!hasAutomations && !showCreate && <ExampleAutomations onSelect={handleExampleClick} />}

          {/* Active automations */}
          {activeAutomations.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
                Active
              </h2>
              <div className="grid grid-cols-1 gap-3">
                {activeAutomations.map((automation) => (
                  <AutomationRow
                    key={automation.id}
                    automation={automation}
                    projects={projects}
                    integrationStatuses={integrationStatuses}
                    onEdit={handleEdit}
                    onToggle={toggle}
                    onDelete={setDeleteTarget}
                    onTriggerNow={triggerNow}
                    onViewLogs={setLogsAutomation}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Paused automations */}
          {pausedAutomations.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
                Paused
              </h2>
              <div className="grid grid-cols-1 gap-3">
                {pausedAutomations.map((automation) => (
                  <AutomationRow
                    key={automation.id}
                    automation={automation}
                    projects={projects}
                    integrationStatuses={integrationStatuses}
                    onEdit={handleEdit}
                    onToggle={toggle}
                    onDelete={setDeleteTarget}
                    onTriggerNow={triggerNow}
                    onViewLogs={setLogsAutomation}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Automation tasks (runs) — below active/paused */}
          <AutomationRunningTasks />
        </div>

        {/* Browse Templates Dialog */}
        <TemplatesDialog
          open={showTemplates}
          onOpenChange={setShowTemplates}
          onSelect={(name, prompt, mode, triggerType) => {
            handleExampleClick(name, prompt, mode, triggerType);
          }}
        />

        {/* Run Logs Modal */}
        <RunLogsModal
          isOpen={!!logsAutomation}
          onClose={() => setLogsAutomation(null)}
          automation={logsAutomation}
          getRunLogs={getRunLogs}
        />

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Automation</AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                This will permanently delete this automation and all its run history. This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-3 sm:gap-3">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
};

export default AutomationsView;
