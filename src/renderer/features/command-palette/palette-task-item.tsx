import { Command } from 'cmdk';
import { GitBranch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { taskAgentStatus } from '@renderer/features/tasks/stores/task-selectors';
import type { TaskStore } from '@renderer/features/tasks/stores/task-store';
import { PALETTE_ITEM_CLASS } from './palette-item-styles';

export const PaletteTaskItem = observer(function PaletteTaskItem({
  taskStore,
  value,
  onSelect,
}: {
  taskStore: TaskStore;
  value: string;
  onSelect: () => void;
}) {
  const status = taskAgentStatus(taskStore);

  return (
    <Command.Item value={value} onSelect={onSelect} className={PALETTE_ITEM_CLASS}>
      <GitBranch size={14} className="shrink-0 text-foreground/40" />
      <span className="flex-1 truncate">{taskStore.data.name}</span>
      <AgentStatusIndicator status={status} disableTooltip />
    </Command.Item>
  );
});
