import { useHotkey } from '@tanstack/react-hotkeys';
import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { ShortcutHint } from '@renderer/components/ui/shortcut-hint';
import { useAppSettingsKey } from '@renderer/core/app/use-app-settings-key';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { getEffectiveHotkey } from '@renderer/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/hooks/useTabShortcuts';
import { useIsActiveTask } from '../hooks/use-is-active-task';
import { TabbedPtyPanel } from '../tabbed-pty-panel';
import { useTaskViewContext } from '../task-view-context';
import { getTerminalsPaneSize, nextTerminalName, TerminalsTabs } from './terminal-tabs';

export const TerminalsPanel = observer(function TerminalsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const terminalMgr = asProvisioned(getTaskStore(projectId, taskId))?.terminals;
  const taskStore = asProvisioned(getTaskStore(projectId, taskId));
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const { isRightOpen } = useWorkspaceLayoutContext();
  const isActive = useIsActiveTask(taskId);
  const [isPanelFocused, setIsPanelFocused] = useState(false);

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

  useTabShortcuts(terminalMgr, { focused: isPanelFocused });
  useHotkey(getEffectiveHotkey('newTerminal', keyboard), () => void handleCreate());

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
        <TerminalsTabs projectId={projectId} taskId={taskId} terminalMgr={terminalMgr ?? null} />
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
