import { Ellipsis, Play, Square, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { EditableNameField } from '@renderer/lib/ui/editable-name-field';
import { PanelTabs } from '@renderer/lib/ui/panel-tabs';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { Automation } from '@shared/automations/automation';
import { makePtySessionId } from '@shared/ptySessionId';
import { isActiveStatus } from '../run-status-styles';
import { useAutomationRuns, useAutomations } from '../use-automations';
import { useAutomationSettingsAutoSave } from '../useAutomationSettingsAutoSave';
import { AutomationSettingsFields } from './AutomationSettingsFields';
import { RunHistory } from './RunHistory';

type AutomationTab = 'runs' | 'settings';

const AUTOMATION_TABS: { value: AutomationTab; label: string }[] = [
  { value: 'runs', label: 'Runs' },
  { value: 'settings', label: 'Settings' },
];

export interface AutomationDetailViewProps {
  automation: Automation;
  onClose: () => void;
  onDelete?: (automation: Automation) => void;
  onRunNow?: (automation: Automation) => void;
  onToggleEnabled?: (automation: Automation, enabled: boolean) => void;
  runNowPending?: boolean;
}

export const AutomationDetailView = observer(function AutomationDetailView({
  automation,
  onClose,
  onDelete,
  onToggleEnabled,
  runNowPending: _runNowPending,
}: AutomationDetailViewProps) {
  const [activeTab, setActiveTab] = useState<AutomationTab>('runs');
  const [cronError, setCronError] = useState<string | null>(null);

  const {
    formState,
    setCronExpr,
    setUseBYOI,
    handlePromptBlur,
    handleNameBlur,
    saveError,
  } = useAutomationSettingsAutoSave(automation);
  const { name, setName } = formState;

  const { runNow } = useAutomations();

  const recentRuns = useAutomationRuns(automation.id, 10);
  const hasActiveRuns = recentRuns.data?.some((r) => isActiveStatus(r.status)) ?? false;
  const canRunNow = automation.enabled && !!automation.projectId && !runNow.isPending;

  function handleStopAll() {
    if (!automation.projectId) return;
    const pid = automation.projectId;
    for (const run of recentRuns.data ?? []) {
      if (!isActiveStatus(run.status)) continue;
      const taskId = run.taskId;
      if (!taskId) continue;
      const mgr = conversationRegistry.get(taskId);
      if (!mgr) continue;
      for (const conv of mgr.conversations.values()) {
        if (conv.status === 'working' || conv.status === 'awaiting-input') {
          void rpc.pty.stopSession(makePtySessionId(pid, taskId, conv.data.id));
        }
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex flex-row items-center gap-3">
              <Switch
                checked={automation.enabled}
                onCheckedChange={(checked) => onToggleEnabled?.(automation, checked)}
                aria-label={automation.enabled ? 'Pause automation' : 'Enable automation'}
              />
              <EditableNameField
                autoFocus={false}
                value={name}
                onChange={setName}
                onBlur={handleNameBlur}
                placeholder="Name this automation"
                className="flex-1"
              />
            </div>
            <div>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
                  <Ellipsis className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end">
                  <DropdownMenuItem variant="destructive" onClick={() => onDelete?.(automation)}>
                    <Trash2 />
                    Delete automation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <PanelTabs compact value={activeTab} onChange={setActiveTab} tabs={AUTOMATION_TABS} />
            {activeTab === 'runs' && (
              <div className="ml-auto flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Stop all active runs"
                        disabled={!hasActiveRuns}
                        onClick={handleStopAll}
                        className={
                          hasActiveRuns
                            ? 'flex h-6 w-6 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground'
                            : 'flex h-6 w-6 cursor-not-allowed items-center justify-center rounded-md text-foreground-passive opacity-40'
                        }
                      />
                    }
                  >
                    <Square className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {hasActiveRuns ? 'Stop all active runs' : 'No active runs'}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Run now"
                        disabled={!canRunNow}
                        onClick={() => void runNow.mutateAsync(automation.id)}
                        className={
                          canRunNow
                            ? 'flex h-6 w-6 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground'
                            : 'flex h-6 w-6 cursor-not-allowed items-center justify-center rounded-md text-foreground-passive opacity-40'
                        }
                      />
                    }
                  >
                    <Play className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {automation.projectId == null ? 'Assign a project before running' : 'Run now'}
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>

          {activeTab === 'runs' && <RunHistory automation={automation} />}
          {activeTab === 'settings' && (
            <AutomationSettingsFields
              state={formState}
              cronError={cronError}
              onCronExprChange={(expr) => {
                setCronExpr(expr);
                setCronError(null);
              }}
              onCronErrorClear={() => setCronError(null)}
              onPromptBlur={handlePromptBlur}
              onUseBYOIChange={setUseBYOI}
              error={saveError}
            />
          )}
        </div>
      </div>
    </div>
  );
});
