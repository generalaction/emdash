import { Command } from 'cmdk';
import { GitBranch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import type { TaskStore } from '@renderer/features/tasks/stores/task';

const ITEM_CLASS =
  'flex cursor-pointer items-center gap-2.5 text-foreground-muted aria-selected:text-foreground rounded-md px-2 py-2 text-sm aria-selected:bg-background-2';

export const PaletteTaskItem = observer(function PaletteTaskItem({
  taskStore,
  value,
  onSelect,
}: {
  taskStore: TaskStore;
  value: string;
  onSelect: () => void;
}) {
  const status = taskStore.provisionedTask?.conversations.taskStatus ?? null;

  return (
    <Command.Item value={value} onSelect={onSelect} className={ITEM_CLASS}>
      <GitBranch size={14} className="shrink-0 text-foreground/40" />
      <span className="flex-1 truncate">{taskStore.data.name}</span>
      <AgentStatusIndicator status={status} disableTooltip />
    </Command.Item>
  );
});
