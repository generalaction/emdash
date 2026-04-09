import { useHotkey } from '@tanstack/react-hotkeys';
import { LayoutList, Play, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { ShortcutHint } from '@renderer/components/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { useAppSettingsKey } from '@renderer/core/app/use-app-settings-key';
import { rpc } from '@renderer/core/ipc';
import { TabViewProvider } from '@renderer/core/stores/generic-tab-view';
import { PtySession } from '@renderer/core/stores/pty-session';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { getEffectiveHotkey } from '@renderer/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/hooks/useTabShortcuts';
import { log } from '@renderer/lib/logger';
import { cn } from '@renderer/lib/utils';
import { useIsActiveTask } from '../hooks/use-is-active-task';
import { TabbedPtyPanel } from '../tabbed-pty-panel';
import { useProvisionedTask, useTaskViewContext } from '../task-view-context';
import {
  getTerminalsPaneSize,
  nextTerminalName,
  ScriptsTabs,
  TerminalsTabs,
} from './terminal-tabs';

type PanelMode = 'terminals' | 'scripts';

type AnyPtyEntity = { data: { id: string }; session: PtySession };

export const TerminalsPanel = observer(function TerminalsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const terminalMgr = provisionedTask.terminals;
  const terminalTabView = provisionedTask.taskView.terminalTabs;
  const lifecycleScriptsMgr = provisionedTask.workspace.lifecycleScripts ?? null;
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const { isRightOpen } = useWorkspaceLayoutContext();
  const isActive = useIsActiveTask(taskId);
  const [isPanelFocused, setIsPanelFocused] = useState(false);
  const [mode, setMode] = useState<PanelMode>('terminals');

  const autoFocus = isActive && isRightOpen && provisionedTask.taskView.focusedRegion === 'right';

  const handleCreate = async () => {
    if (!terminalMgr) return;
    provisionedTask.taskView.setFocusedRegion('right');
    const id = crypto.randomUUID();
    const name = nextTerminalName((terminalTabView.tabs ?? []).map((s) => s.data.name));
    try {
      await terminalMgr.createTerminal({
        id,
        projectId,
        taskId,
        name,
        initialSize: getTerminalsPaneSize(),
      });
      terminalTabView.setActiveTab(id);
    } catch (error) {
      log.error('Failed to create terminal:', error);
    }
  };

  const handleRunScript = () => {
    const activeScript = lifecycleScriptsMgr?.activeTab;
    if (!activeScript) return;
    void rpc.terminals.runLifecycleScript({
      projectId,
      workspaceId: provisionedTask.workspaceId,
      type: activeScript.data.type,
    });
  };

  const activeStore = mode === 'terminals' ? terminalTabView : lifecycleScriptsMgr;
  useTabShortcuts(activeStore ?? undefined, { focused: isPanelFocused });
  useHotkey(getEffectiveHotkey('newTerminal', keyboard), () => void handleCreate(), {
    enabled: mode === 'terminals',
  });

  const runScriptButton = (
    <Tooltip>
      <TooltipTrigger>
        <button
          className="size-10 justify-center items-center flex border-l hover:bg-background text-foreground-muted hover:text-foreground"
          onClick={handleRunScript}
        >
          <Play className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Run script</TooltipContent>
    </Tooltip>
  );

  const toggleButton = lifecycleScriptsMgr ? (
    <div className="flex items-center border-l">
      <Tooltip>
        <TooltipTrigger>
          <button
            className={cn(
              'size-10 flex items-center justify-center',
              mode === 'terminals'
                ? 'text-foreground bg-background-2'
                : 'text-foreground-muted hover:text-foreground'
            )}
            onClick={() => setMode('terminals')}
          >
            <Terminal className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Terminals</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <button
            className={cn(
              'size-10 flex items-center justify-center',
              mode === 'scripts'
                ? 'text-foreground bg-background-2'
                : 'text-foreground-muted hover:text-foreground'
            )}
            onClick={() => setMode('scripts')}
          >
            <LayoutList className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Lifecycle Scripts</TooltipContent>
      </Tooltip>
    </div>
  ) : null;

  const store = (mode === 'terminals' ? terminalTabView : lifecycleScriptsMgr) as
    | TabViewProvider<AnyPtyEntity, never>
    | undefined;

  const tabBar =
    mode === 'terminals' ? (
      <TerminalsTabs
        projectId={projectId}
        taskId={taskId}
        terminalTabView={terminalTabView}
        terminalMgr={terminalMgr}
        actions={toggleButton}
      />
    ) : (
      <ScriptsTabs
        lifecycleScriptsMgr={lifecycleScriptsMgr}
        actions={
          <div className="flex items-center">
            {runScriptButton}
            {toggleButton}
          </div>
        }
      />
    );

  const emptyState =
    mode === 'terminals' ? (
      <EmptyState
        icon={<Terminal className="h-5 w-5 text-muted-foreground" />}
        label="No terminals yet"
        description="Add a terminal to run shell commands in this task's working directory."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={handleCreate}
            className="flex items-center gap-2"
          >
            New terminal
            <ShortcutHint settingsKey="newTerminal" />
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<LayoutList className="h-5 w-5 text-muted-foreground" />}
        label="No lifecycle scripts"
        description="Add setup or run scripts to .emdash.json to see them here."
        action={
          <Button size="sm" variant="outline" onClick={() => setMode('terminals')}>
            Back to terminals
          </Button>
        }
      />
    );

  return (
    <TabbedPtyPanel
      autoFocus={autoFocus}
      onFocusChange={(focused) => {
        setIsPanelFocused(focused);
        if (focused) provisionedTask.taskView.setFocusedRegion('right');
      }}
      store={store}
      paneId={mode === 'terminals' ? 'terminals' : 'lifecycle-scripts'}
      getSessionId={(s) => makePtySessionId(projectId, taskId, s.data.id)}
      getSession={(s) => s.session}
      tabBar={tabBar}
      emptyState={emptyState}
    />
  );
});
