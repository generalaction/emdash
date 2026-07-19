import { Command } from 'cmdk';
import { GitBranch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { taskAgentStatus } from '@core/features/conversations/browser/conversation-selectors';
import type { TaskStore } from '@core/features/tasks/browser/stores/task-store';
import { AgentStatusIndicator } from '@renderer/lib/components/agent-status-indicator';
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
