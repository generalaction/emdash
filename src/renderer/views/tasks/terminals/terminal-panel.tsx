import { useHotkey } from '@tanstack/react-hotkeys';
import { LayoutList, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { ShortcutHint } from '@renderer/components/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { useAppSettingsKey } from '@renderer/core/app/use-app-settings-key';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { getEffectiveHotkey } from '@renderer/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/hooks/useTabShortcuts';
import { useIsActiveTask } from '../hooks/use-is-active-task';
import { TabbedPtyPanel } from '../tabbed-pty-panel';
import { useTaskViewContext } from '../task-view-context';
import {
  getTerminalsPaneSize,
  nextTerminalName,
  ScriptsTabs,
  TerminalsTabs,
} from './terminal-tabs';

type PanelMode = 'terminals' | 'scripts';

export const TerminalsPanel = observer(function TerminalsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = asProvisioned(getTaskStore(projectId, taskId));
  const terminalMgr = taskStore?.terminals;
  const lifecycleScriptsMgr = taskStore?.lifecycleScripts ?? null;
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const { isRightOpen } = useWorkspaceLayoutContext();
  const isActive = useIsActiveTask(taskId);
  const [isPanelFocused, setIsPanelFocused] = useState(false);
  const [mode, setMode] = useState<PanelMode>('terminals');

  const autoFocus = isActive && isRightOpen && taskStore?.focusedRegion === 'right';

  const handleCreate = async () => {
    if (!terminalMgr) return;
    taskStore?.setFocusedRegion('right');
    const id = crypto.randomUUID();
    const name = nextTerminalName(terminalMgr.tabs.map((s) => s.data.name));
    try {
      await terminalMgr.createTerminal({
        id,
        projectId,
        taskId,
        name,
        initialSize: getTerminalsPaneSize(),
      });
    } catch (error) {
      console.error('Failed to create terminal:', error);
    }
  };

  const activeStore = mode === 'terminals' ? terminalMgr : lifecycleScriptsMgr;
  useTabShortcuts(activeStore ?? undefined, { focused: isPanelFocused });
  useHotkey(getEffectiveHotkey('newTerminal', keyboard), () => void handleCreate(), {
    enabled: mode === 'terminals',
  });

  const toggleButton = lifecycleScriptsMgr ? (
    <Tooltip>
      <TooltipTrigger>
        <button
          className={`size-10 justify-center items-center flex border-l hover:bg-background ${
            mode === 'scripts' ? 'text-foreground' : 'text-foreground-muted hover:text-foreground'
          }`}
          onClick={() => setMode((m) => (m === 'terminals' ? 'scripts' : 'terminals'))}
        >
          <LayoutList className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {mode === 'terminals' ? 'Show lifecycle scripts' : 'Show terminals'}
      </TooltipContent>
    </Tooltip>
  ) : null;

  if (mode === 'scripts') {
    return (
      <TabbedPtyPanel
        autoFocus={autoFocus}
        onFocusChange={(focused) => {
          setIsPanelFocused(focused);
          if (focused) taskStore?.setFocusedRegion('right');
        }}
        store={lifecycleScriptsMgr ?? undefined}
        paneId="lifecycle-scripts"
        getSessionId={(s) => makePtySessionId(projectId, taskId, s.data.id)}
        getSession={(s) => s.session}
        tabBar={<ScriptsTabs lifecycleScriptsMgr={lifecycleScriptsMgr} actions={toggleButton} />}
        emptyState={
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
        }
      />
    );
  }

  return (
    <TabbedPtyPanel
      autoFocus={autoFocus}
      onFocusChange={(focused) => {
        setIsPanelFocused(focused);
        if (focused) taskStore?.setFocusedRegion('right');
      }}
      store={terminalMgr}
      paneId="terminals"
      getSessionId={(s) => makePtySessionId(projectId, taskId, s.data.id)}
      getSession={(s) => s.session}
      tabBar={
        <TerminalsTabs
          projectId={projectId}
          taskId={taskId}
          terminalMgr={terminalMgr ?? null}
          actions={toggleButton}
        />
      }
      emptyState={
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
      }
    />
  );
});
