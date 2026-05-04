import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { FolderOpen, GitBranch, Zap } from 'lucide-react';
import React, { useDeferredValue, useState } from 'react';
import type { SearchItem } from '@shared/search';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useModalContext, type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { cn } from '@renderer/utils/utils';
import { buildActions, type CommandActionWithHandler } from './actions';
import { applyContextAffinity, rrf } from './rrf';

interface CommandPaletteProps {
  projectId?: string;
  taskId?: string;
}

type MergedResult = SearchItem | CommandActionWithHandler;

const KIND_ICON: Record<string, React.ReactNode> = {
  action: <Zap size={14} className="shrink-0 text-foreground/40" />,
  task: <GitBranch size={14} className="shrink-0 text-foreground/40" />,
  project: <FolderOpen size={14} className="shrink-0 text-foreground/40" />,
};

const GROUP_CLASS = cn(
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
  '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
  '[&_[cmdk-group-heading]]:text-foreground/50'
);

function PaletteItem({
  value,
  item,
  onSelect,
}: {
  value: string;
  item: MergedResult;
  onSelect: () => void;
}) {
  const action = item.kind === 'action' ? (item as CommandActionWithHandler) : null;
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 text-foreground-muted aria-selected:text-foreground rounded-md px-2 py-2 text-sm aria-selected:bg-background-2"
    >
      {KIND_ICON[item.kind]}
      <span className="flex-1 truncate">{item.title}</span>
      {action?.shortcut && (
        <kbd className="shrink-0 rounded bg-background-quaternary px-1.5 py-0.5 text-xs text-foreground/60">
          {action.shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}

export function CommandPaletteModal({
  projectId,
  taskId,
  onClose,
}: CommandPaletteProps & BaseModalProps) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const { navigate } = useNavigate();
  const { showModal, closeModal } = useModalContext();

  const { data: dbResults = [] } = useQuery({
    queryKey: ['cmdk-search', deferred, projectId, taskId],
    queryFn: () => rpc.search.commandPalette({ query: deferred, context: { projectId, taskId } }),
    staleTime: 0,
    placeholderData: (prev) => prev,
  });

  const actions = buildActions({ projectId, taskId, navigate, showModal, closeModal });
  const rankedDb = applyContextAffinity(dbResults, { projectId });
  const merged = rrf<MergedResult>([rankedDb as MergedResult[], actions as MergedResult[]]);

  const actionResults = merged.filter((r): r is CommandActionWithHandler => r.kind === 'action');
  const taskResults = merged.filter((r): r is SearchItem => r.kind === 'task');
  const projectResults = merged.filter((r): r is SearchItem => r.kind === 'project');

  const handleNavigateToTask = (item: SearchItem) => {
    if (!item.projectId) return;
    onClose();
    navigate('task', { projectId: item.projectId, taskId: item.id });
  };

  const handleNavigateToProject = (item: SearchItem) => {
    onClose();
    navigate('project', { projectId: item.id });
  };

  const handleSelect = (item: MergedResult) => {
    if (item.kind === 'action') return (item as CommandActionWithHandler).execute();
    if (item.kind === 'task') return handleNavigateToTask(item as SearchItem);
    if (item.kind === 'project') return handleNavigateToProject(item as SearchItem);
  };

  return (
    <Command className="flex flex-col overflow-hidden" shouldFilter={false} loop>
      <div className="border-b border-foreground/10 px-1">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search tasks, projects, actions…"
          className="w-full bg-transparent px-3 py-3 text-sm outline-none placeholder:text-foreground/40"
          autoFocus
        />
      </div>
      <Command.List className="h-96 overflow-y-auto p-1">
        {query ? (
          <>
            <Command.Empty className="py-8 text-center text-sm text-foreground/40">
              No results for &ldquo;{query}&rdquo;
            </Command.Empty>
            {merged.map((item) => (
              <PaletteItem
                key={`${item.kind}:${item.id}`}
                value={`${item.kind}:${item.id}`}
                item={item}
                onSelect={() => handleSelect(item)}
              />
            ))}
          </>
        ) : (
          <>
            {actionResults.length > 0 && (
              <Command.Group heading="Actions" className={GROUP_CLASS}>
                {actionResults.map((item) => (
                  <PaletteItem key={item.id} value={item.id} item={item} onSelect={item.execute} />
                ))}
              </Command.Group>
            )}
            {taskResults.length > 0 && (
              <Command.Group heading="Tasks" className={GROUP_CLASS}>
                {taskResults.map((item) => (
                  <PaletteItem
                    key={item.id}
                    value={item.id}
                    item={item}
                    onSelect={() => handleNavigateToTask(item)}
                  />
                ))}
              </Command.Group>
            )}
            {projectResults.length > 0 && (
              <Command.Group heading="Projects" className={GROUP_CLASS}>
                {projectResults.map((item) => (
                  <PaletteItem
                    key={item.id}
                    value={item.id}
                    item={item}
                    onSelect={() => handleNavigateToProject(item)}
                  />
                ))}
              </Command.Group>
            )}
          </>
        )}
      </Command.List>

      <div className="flex items-center gap-4 border-t border-foreground/10 px-3 py-2">
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            ↑
          </kbd>
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            ↓
          </kbd>
          Navigate
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            ↵
          </kbd>
          Select
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            Esc
          </kbd>
          Close
        </span>
      </div>
    </Command>
  );
}
