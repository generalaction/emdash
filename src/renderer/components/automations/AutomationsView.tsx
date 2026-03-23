import React, { useState } from 'react';
import { Plus, Loader2, X } from 'lucide-react';
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
import AutomationInlineCreate from './AutomationInlineCreate';
import AutomationRunningTasks from './AutomationRunningTasks';
import ExampleAutomations from './ExampleAutomations';
import RunLogsModal from './RunLogsModal';
import { useAutomations } from './useAutomations';
import { useProjectManagementContext } from '../../contexts/ProjectManagementProvider';
import type { Automation, UpdateAutomationInput } from '@shared/automations/types';

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

  const [showCreate, setShowCreate] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [logsAutomation, setLogsAutomation] = useState<Automation | null>(null);
  const [prefill, setPrefill] = useState<{ name: string; prompt: string } | null>(null);

  const handleEdit = (automation: Automation) => {
    setShowCreate(false);
    setPrefill(null);
    setEditingAutomation(automation);
  };

  const handleUpdate = async (input: UpdateAutomationInput) => {
    await update(input);
    setEditingAutomation(null);
  };

  const handleDelete = async () => {
    if (deleteTarget) {
      await remove(deleteTarget);
      setDeleteTarget(null);
    }
  };

  const handleExampleClick = (name: string, prompt: string) => {
    setPrefill({ name, prompt });
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
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold">Automations</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Schedule recurring tasks to run automatically on your projects
            </p>
          </div>
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
                  await create(input);
                  setShowCreate(false);
                  setPrefill(null);
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

        {/* Empty state with examples */}
        {!hasAutomations && !showCreate && <ExampleAutomations onSelect={handleExampleClick} />}

        {/* Active automations */}
        {activeAutomations.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">Active</h2>
            <div className="grid grid-cols-1 gap-3">
              {activeAutomations.map((automation) => (
                <AutomationRow
                  key={automation.id}
                  automation={automation}
                  projects={projects}
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
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">Paused</h2>
            <div className="grid grid-cols-1 gap-3">
              {pausedAutomations.map((automation) => (
                <AutomationRow
                  key={automation.id}
                  automation={automation}
                  projects={projects}
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
  );
};

export default AutomationsView;
