import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import type { FileNode } from '@shared/fs';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@renderer/lib/ui/command';

const MAX_RESULTS = 100;

function scoreFile(node: FileNode, query: string): number {
  const name = node.name.toLowerCase();
  const path = node.path.toLowerCase();

  if (name === query) return 1000;
  if (name.startsWith(query)) return Math.max(1, 900 - node.depth);
  const nameIdx = name.indexOf(query);
  if (nameIdx >= 0) return Math.max(1, 700 - nameIdx - node.depth);
  const pathIdx = path.indexOf(query);
  if (pathIdx >= 0) return Math.max(1, 400 - pathIdx);

  let qi = 0;
  for (let i = 0; i < name.length && qi < query.length; i++) {
    if (name[i] === query[qi]) qi++;
  }
  if (qi === query.length) return Math.max(1, 100 - (name.length - query.length));
  return -1;
}

export const FileSearchModal = observer(function FileSearchModal({
  onSuccess,
}: BaseModalProps<void>) {
  const taskState = useProvisionedTask();
  const files = taskState.workspace.files;
  const editorView = taskState.taskView.editorView;
  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim().toLowerCase();
  const fileTreeData = files.tree.data;

  const allFiles = useMemo(() => {
    const entries: FileNode[] = [];
    const nodes = fileTreeData?.nodes ?? files.nodes;
    for (const node of nodes.values()) {
      if (node.type === 'file') entries.push(node);
    }
    return entries;
  }, [fileTreeData, files]);

  const recentFiles = useMemo(
    () =>
      [...allFiles]
        .sort((a, b) => (b.mtime?.getTime() ?? 0) - (a.mtime?.getTime() ?? 0))
        .slice(0, MAX_RESULTS),
    [allFiles]
  );

  const entries = useMemo(() => {
    if (!trimmedQuery) return recentFiles;

    const scored: Array<{ node: FileNode; score: number }> = [];
    for (const node of allFiles) {
      const score = scoreFile(node, trimmedQuery);
      if (score > 0) scored.push({ node, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_RESULTS).map((s) => s.node);
  }, [allFiles, recentFiles, trimmedQuery]);

  const isInitialLoad = files.isLoading && files.nodes.size === 0;

  return (
    <Command label="Search files" shouldFilter={false}>
      <CommandInput placeholder="Search files…" autoFocus value={query} onValueChange={setQuery} />
      <CommandList>
        {isInitialLoad ? (
          <div className="py-6 text-center text-sm text-foreground-muted">Loading files…</div>
        ) : (
          <>
            <CommandEmpty>No files found.</CommandEmpty>
            {entries.map((node) => (
              <CommandItem
                key={node.path}
                value={node.path}
                onSelect={() => {
                  editorView.openFile(node.path);
                  onSuccess();
                }}
              >
                <FileIcon filename={node.name} size={14} />
                <span className="truncate">{node.name}</span>
                {node.parentPath ? (
                  <span className="ml-auto truncate pl-4 text-xs text-foreground-muted">
                    {node.parentPath}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </>
        )}
      </CommandList>
    </Command>
  );
});
