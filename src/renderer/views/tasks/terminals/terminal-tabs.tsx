import { CircleFadingArrowUp, CirclePlayIcon, Plus, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import ShortcutHint from '@renderer/components/ui/shortcut-hint';
import { TabBar } from '@renderer/components/ui/tab-bar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { getPaneContainer } from '@renderer/core/pty/pane-sizing-context';
import { measureDimensions } from '@renderer/core/pty/pty-dimensions';
import {
  LifecycleScriptsStore,
  LifecycleScriptStore,
  ScriptType,
} from '@renderer/core/stores/lifecycle-scripts';
import { TerminalManagerStore, TerminalStore } from '@renderer/core/stores/terminal-manager';
import { TerminalTabViewStore } from '@renderer/core/stores/terminal-tab-view-store';

export function getTerminalsPaneSize() {
  const container = getPaneContainer('terminals');
  return container ? (measureDimensions(container, 8, 16) ?? undefined) : undefined;
}

export function nextTerminalName(names: string[]): string {
  const taken = new Set(
    names
      .map((n) => /^Terminal (\d+)$/.exec(n)?.[1])
      .filter(Boolean)
      .map(Number)
  );
  let n = 1;
  while (taken.has(n)) n++;
  return `Terminal ${n}`;
}

function scriptIcon(type: ScriptType): React.ReactNode {
  if (type === 'setup') return <CircleFadingArrowUp className="size-3.5" />;
  if (type === 'run') return <CirclePlayIcon className="size-3.5" />;
  return <CircleFadingArrowUp className="size-3.5 rotate-180" />;
}

interface TerminalsTabsProps {
  projectId: string;
  taskId: string;
  terminalTabView: TerminalTabViewStore | null;
  terminalMgr: TerminalManagerStore | null;
  /** Extra content rendered in the right-side actions area (e.g. mode toggle button). */
  actions?: React.ReactNode;
}

export const TerminalsTabs = observer(function TerminalsTabs({
  projectId,
  taskId,
  terminalTabView,
  terminalMgr,
  actions,
}: TerminalsTabsProps) {
  if (!terminalTabView || !terminalMgr) return null;

  const handleAdd = async () => {
    const id = crypto.randomUUID();
    const name = nextTerminalName(terminalTabView.tabs.map((s) => s.data.name));
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
      console.error('Failed to create terminal:', error);
    }
  };

  return (
    <TabBar<TerminalStore>
      tabs={terminalTabView.tabs}
      activeTabId={terminalTabView.activeTabId}
      getId={(s) => s.data.id}
      getLabel={(s) => s.data.name}
      onSelect={(id) => terminalTabView.setActiveTab(id)}
      onRemove={(id) => {
        terminalTabView.removeTab(id);
      }}
      renderTabPrefix={() => <Terminal className="size-3" />}
      onRename={(id, name) => void terminalMgr.renameTerminal(id, name)}
      onReorder={(from, to) => terminalTabView.reorderTabs(from, to)}
      actions={
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger>
              <button
                className="size-10 justify-center items-center flex border-l hover:bg-background text-foreground-muted hover:text-foreground"
                onClick={() => void handleAdd()}
              >
                <Plus className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Create terminal
              <ShortcutHint settingsKey="newTerminal" />
            </TooltipContent>
          </Tooltip>
          {actions}
        </div>
      }
    />
  );
});

interface ScriptsTabsProps {
  lifecycleScriptsMgr: LifecycleScriptsStore | null;
  /** Extra content rendered in the right-side actions area (e.g. mode toggle button). */
  actions?: React.ReactNode;
}

export const ScriptsTabs = observer(function ScriptsTabs({
  lifecycleScriptsMgr,
  actions,
}: ScriptsTabsProps) {
  if (!lifecycleScriptsMgr) return null;

  return (
    <TabBar<LifecycleScriptStore>
      tabs={lifecycleScriptsMgr.tabs}
      activeTabId={lifecycleScriptsMgr.activeTabId}
      getId={(s) => s.data.id}
      getLabel={(s) => s.data.label}
      onSelect={(id) => lifecycleScriptsMgr.setActiveTab(id)}
      renderTabPrefix={(s) => scriptIcon(s.data.type)}
      actions={actions}
    />
  );
});
