import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { makePtySessionId } from '@shared/ptySessionId';
import { TabBar } from '@renderer/components/ui/tab-bar';
import { getPaneContainer } from '@renderer/core/pty/pane-sizing-context';
import { frontendPtyRegistry } from '@renderer/core/pty/pty';
import { measureDimensions } from '@renderer/core/pty/pty-dimensions';
import { TerminalManagerStore, TerminalStore } from '@renderer/core/stores/terminal-manager';

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

interface TerminalsTabsProps {
  projectId: string;
  taskId: string;
  terminalMgr: TerminalManagerStore | null;
}

export const TerminalsTabs = observer(function TerminalsTabs({
  projectId,
  taskId,
  terminalMgr,
}: TerminalsTabsProps) {
  if (!terminalMgr) return null;

  return (
    <TabBar<TerminalStore>
      tabs={terminalMgr.tabs}
      activeTabId={terminalMgr.activeTabId}
      getId={(s) => s.data.id}
      getLabel={(s) => s.data.name}
      onSelect={(id) => terminalMgr.setActiveTab(id)}
      onRemove={(id) => {
        frontendPtyRegistry.unregister(makePtySessionId(projectId, taskId, id));
        terminalMgr.removeTab(id);
      }}
      onAdd={async () => {
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
      }}
      renderTabPrefix={() => <Terminal className="size-3" />}
      onRename={(id, name) => void terminalMgr.renameTerminal(id, name)}
      onReorder={(from, to) => terminalMgr.reorderTabs(from, to)}
    />
  );
});
