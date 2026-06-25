import { Terminal } from 'lucide-react';
import { action, reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import type {
  ResolveContext,
  ResolvedTab,
  TabContentProps,
  TabProvider,
  TabViewContext,
} from '@renderer/features/tabs/core/tab-provider';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import type { TabDescriptor } from '@shared/view-state';
import type { TaskTabContext } from '../stores/task-tab-context';
import { terminalRegistry } from '../stores/terminal-registry';
import { workspaceRegistry } from '../stores/workspace-registry';
import type { TerminalStore } from './terminal-manager';
import { TerminalPtyContent } from './terminal-pty-content';
import { TerminalTabEntry } from './terminal-tab-entry';
import { TerminalTabDragPreview, TerminalTabItem } from './terminal-tab-item';

export interface TerminalOpenArgs {
  terminalId: string;
  /** When true, opens as a preview tab. Terminal command flows create stable tabs. */
  preview?: boolean;
}

export interface TerminalResolvedData {
  terminalId: string;
  terminal: TerminalStore;
}

type TerminalDescriptor = Extract<TabDescriptor, { kind: 'terminal' }>;

const TerminalTabContent = observer(function TerminalTabContent({ host, ctx }: TabContentProps) {
  const taskCtx = ctx as TaskTabContext;
  const terminalMgr = terminalRegistry.get(taskCtx.taskId);
  const workspace = workspaceRegistry.get(taskCtx.projectId, taskCtx.workspaceId);
  const terminalTabs = host.resolvedTabs.filter(
    (t): t is ResolvedTab<TerminalResolvedData> => t.kind === 'terminal'
  );
  const activeTerminalTab = terminalTabs.find((tab) => tab.isActive) ?? null;
  const activeSession =
    activeTerminalTab !== null
      ? (terminalMgr?.sessions.get(activeTerminalTab.terminalId) ?? null)
      : null;
  const allSessionIds = terminalTabs
    .map((tab) => terminalMgr?.sessions.get(tab.terminalId)?.sessionId)
    .filter((id): id is string => Boolean(id));

  return (
    <TerminalPtyContent
      className="h-full"
      activeSession={activeSession}
      allSessionIds={allSessionIds}
      autoFocus={host.isFocused && activeTerminalTab !== null}
      emptyState={
        <EmptyState
          icon={<Terminal className="text-muted-foreground h-5 w-5" />}
          label="Terminal unavailable"
          description="This terminal is no longer available."
        />
      }
      remoteConnectionId={workspace?.sshConnectionId}
      workspaceId={taskCtx.workspaceId}
    />
  );
});

export const terminalTabProvider: TabProvider<
  'terminal',
  TerminalTabEntry,
  TerminalResolvedData,
  TerminalDescriptor,
  TerminalOpenArgs
> = {
  kind: 'terminal',

  resolve(entry: TerminalTabEntry, ctx: ResolveContext): TerminalResolvedData | null {
    const terminal = terminalRegistry
      .get((ctx as unknown as TaskTabContext).taskId)
      ?.terminals.get(entry.terminalId);
    if (!terminal) return null;
    return { terminalId: entry.terminalId, terminal };
  },

  serialize(entry: TerminalTabEntry): TerminalDescriptor {
    return {
      kind: 'terminal',
      tabId: entry.tabId,
      terminalId: entry.terminalId,
      isPreview: entry.isPreview,
    };
  },

  deserialize(data: TerminalDescriptor, _ctx: TabViewContext): TerminalTabEntry {
    return new TerminalTabEntry(data.terminalId, data.isPreview, data.tabId);
  },

  TabItem: TerminalTabItem,
  DragPreview: TerminalTabDragPreview,
  Content: TerminalTabContent,

  title(tab: ResolvedTab<TerminalResolvedData>): string {
    return tab.terminal.data.name;
  },

  open(args: TerminalOpenArgs, host, _ctx): void {
    const existing = host.findEntry(
      (e): e is TerminalTabEntry =>
        (e as TerminalTabEntry).kind === 'terminal' &&
        (e as TerminalTabEntry).terminalId === args.terminalId
    );

    if (existing) {
      existing.isPreview = false;
      host.setActiveTab(existing.tabId);
      return;
    }

    host.attachEntry(new TerminalTabEntry(args.terminalId, Boolean(args.preview)), {
      activate: true,
    });
  },

  mount(host, ctx): () => void {
    const taskCtx = ctx as TaskTabContext;
    return reaction(
      () => Array.from(terminalRegistry.get(taskCtx.taskId)?.terminals.keys() ?? []),
      action((ids) => {
        const idSet = new Set(ids);
        while (true) {
          const stale = host.findEntry(
            (e): e is TerminalTabEntry =>
              (e as TerminalTabEntry).kind === 'terminal' &&
              !idSet.has((e as TerminalTabEntry).terminalId)
          );
          if (!stale) break;
          host.closeTab(stale.tabId);
        }
      })
    );
  },

  rename(entry: TerminalTabEntry, name: string, ctx: TabViewContext): void {
    void terminalRegistry
      .get((ctx as TaskTabContext).taskId)
      ?.renameTerminal(entry.terminalId, name);
  },
};
