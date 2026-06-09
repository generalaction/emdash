import { Ellipsis, Play, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
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
import type { Automation } from '@shared/core/automations/automation';
import { useAutomationEventBridge, useAutomations } from '../use-automations';
import { useAutomationSettingsAutoSave } from '../useAutomationSettingsAutoSave';
import { AutomationSettingsFields } from './AutomationSettingsFields';
import { NextRunBanner } from './NextRunBanner';
import { RunHistory } from './RunHistory';
import { SheetHeader } from './sheet-header';

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

  useAutomationEventBridge(automation.id);

  const { formState, setCronExpr, handlePromptBlur, handleNameBlur, saveError } =
    useAutomationSettingsAutoSave(automation);
  const { name, setName } = formState;

  const { runNow } = useAutomations();

  const canRunNow = !!automation.projectId && !runNow.isPending;

  return (
    <div className="flex h-full flex-col">
      <SheetHeader title="Automation details" onClose={onClose} />
      <div className="flex flex-col gap-2 px-4">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex flex-1 flex-row items-center gap-3">
            <EditableNameField
              autoFocus={false}
              value={name}
              onChange={setName}
              onBlur={handleNameBlur}
              placeholder="Name this automation"
              className="flex-1"
            />
          </div>
          <div className="flex items-center gap-2">
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
            <Switch
              checked={automation.enabled}
              onCheckedChange={(checked) => onToggleEnabled?.(automation, checked)}
              aria-label={automation.enabled ? 'Pause automation' : 'Enable automation'}
            />
          </div>
        </div>
        <NextRunBanner automationId={automation.id} />
        <div className="flex items-center gap-2 py-2">
          <PanelTabs compact value={activeTab} onChange={setActiveTab} tabs={AUTOMATION_TABS} />
          {activeTab === 'runs' && (
            <div className="ml-auto flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-md"
                      disabled={!canRunNow}
                      onClick={() => void runNow.mutateAsync(automation.id)}
                    />
                  }
                >
                  <Play className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>
                  {automation.projectId == null
                    ? 'Assign a project before running'
                    : !automation.conversationConfig || !automation.triggerConfig
                      ? 'Configure the automation before running'
                      : 'Run now'}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
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
            error={saveError}
          />
        )}
      </div>
    </div>
  );
});
