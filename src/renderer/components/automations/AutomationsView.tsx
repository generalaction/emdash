import React, { useState } from 'react';
import { Plus, RefreshCw, Loader2, Timer, Search, Zap, Activity } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
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
import AutomationCard from './AutomationCard';
import AutomationModal from './AutomationModal';
import RunLogsModal from './RunLogsModal';
import { useAutomations } from './useAutomations';
import { useRunningAutomations } from './useRunningAutomations';
import { useProjectManagementContext } from '../../contexts/ProjectManagementProvider';
import type { Automation, CreateAutomationInput } from '@shared/automations/types';

const AutomationsView: React.FC = () => {
  const {
    automations,
    isLoading,
    refresh,
    create,
    update,
    remove,
    toggle,
    getRunLogs,
    triggerNow,
  } = useAutomations();

  const { projects } = useProjectManagementContext();

  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [logsAutomation, setLogsAutomation] = useState<Automation | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  const handleCreate = async (input: CreateAutomationInput) => {
    await create(input);
  };

  const handleUpdate = async (id: string, input: Partial<CreateAutomationInput>) => {
    await update({ id, ...input });
  };

  const handleDelete = async () => {
    if (deleteTarget) {
      await remove(deleteTarget);
      setDeleteTarget(null);
    }
  };

  const handleToggle = async (id: string) => {
    await toggle(id);
  };

  const handleTriggerNow = async (id: string) => {
    // triggerNow sends via IPC to main, which sends back an automation:trigger event
    // that gets picked up by our listener above — creating the task
    await triggerNow(id);
  };

  const { allRunning, isRunning } = useRunningAutomations();

  const filteredAutomations = searchQuery
    ? automations.filter(
        (a) =>
          a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.prompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.projectName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : automations;

  // Separate currently-running automations from the rest
  const runningAutomations = filteredAutomations.filter((a) => isRunning(a.id));
  const nonRunningFiltered = filteredAutomations.filter((a) => !isRunning(a.id));
  const activeAutomations = nonRunningFiltered.filter((a) => a.status === 'active');
  const pausedAutomations = nonRunningFiltered.filter((a) => a.status !== 'active');

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
        <div className="mb-6">
          <h1 className="text-lg font-semibold">Automations</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Schedule recurring tasks to run automatically with your coding agents
          </p>
        </div>

        {/* Toolbar */}
        <TooltipProvider delayDuration={300}>
          <div className="mb-6 flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search automations..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">Search by name, prompt, or project</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  aria-label="Refresh automations"
                >
                  <RefreshCw
                    className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh automations</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={() => setShowCreateModal(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  New Automation
                </Button>
              </TooltipTrigger>
              <TooltipContent>Create a new scheduled automation</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

        {/* Info banner */}
        {automations.length > 0 && !searchQuery && (
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
            <Zap className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground/60" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Automations run your coding agents on a schedule. Each run creates a new task in the
              selected project with the configured prompt. Pause or edit any automation at any time.
            </p>
          </div>
        )}

        {/* Empty state */}
        {automations.length === 0 && (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/40">
              <Timer className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <h2 className="mb-1.5 text-sm font-semibold">No automations yet</h2>
            <p className="mx-auto mb-5 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Create your first automation to schedule recurring agent tasks. Pick a project, write
              a prompt, choose your coding agent, and set a schedule.
            </p>
            <Button variant="outline" size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create Automation
            </Button>
          </div>
        )}

        {/* Running Now — shown when any automation is actively being triggered */}
        {runningAutomations.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wide text-blue-600 dark:text-blue-400">
              <Activity className="h-3 w-3" />
              Running Now
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500/15 px-1 text-[10px] font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                {runningAutomations.length}
              </span>
            </h2>
            <div className="space-y-3">
              {runningAutomations.map((automation) => (
                <AutomationCard
                  key={automation.id}
                  automation={automation}
                  projects={projects}
                  onEdit={setEditingAutomation}
                  onToggle={handleToggle}
                  onDelete={setDeleteTarget}
                  onTriggerNow={handleTriggerNow}
                  onViewLogs={setLogsAutomation}
                />
              ))}
            </div>
          </div>
        )}

        {/* Active automations */}
        {activeAutomations.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">Active</h2>
            <div className="space-y-3">
              {activeAutomations.map((automation) => (
                <AutomationCard
                  key={automation.id}
                  automation={automation}
                  projects={projects}
                  onEdit={setEditingAutomation}
                  onToggle={handleToggle}
                  onDelete={setDeleteTarget}
                  onTriggerNow={handleTriggerNow}
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
            <div className="space-y-3">
              {pausedAutomations.map((automation) => (
                <AutomationCard
                  key={automation.id}
                  automation={automation}
                  projects={projects}
                  onEdit={setEditingAutomation}
                  onToggle={handleToggle}
                  onDelete={setDeleteTarget}
                  onTriggerNow={handleTriggerNow}
                  onViewLogs={setLogsAutomation}
                />
              ))}
            </div>
          </div>
        )}

        {/* Search no results */}
        {searchQuery && filteredAutomations.length === 0 && automations.length > 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">No automations match your search.</p>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <AutomationModal
        isOpen={showCreateModal || !!editingAutomation}
        onClose={() => {
          setShowCreateModal(false);
          setEditingAutomation(null);
        }}
        onSave={handleCreate}
        onUpdate={handleUpdate}
        projects={projects}
        editingAutomation={editingAutomation}
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
          <AlertDialogFooter>
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
