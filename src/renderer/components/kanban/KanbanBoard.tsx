import React from 'react';
import type { Project, Workspace } from '../../types/app';
import KanbanColumn from './KanbanColumn';
import KanbanCard from './KanbanCard';
import { getAll, getStatus, setStatus, type KanbanStatus } from '../../lib/kanbanStore';

const order: KanbanStatus[] = ['todo', 'in-progress', 'done'];
const titles: Record<KanbanStatus, string> = {
  'todo': 'To‑do',
  'in-progress': 'In‑progress',
  'done': 'Done',
};

const KanbanBoard: React.FC<{
  project: Project;
  onOpenWorkspace?: (ws: Workspace) => void;
}> = ({ project, onOpenWorkspace }) => {
  const [statusMap, setStatusMap] = React.useState<Record<string, KanbanStatus>>({});

  React.useEffect(() => {
    setStatusMap(getAll());
  }, [project.id]);

  const byStatus: Record<KanbanStatus, Workspace[]> = { 'todo': [], 'in-progress': [], 'done': [] };
  for (const ws of project.workspaces || []) {
    const s = statusMap[ws.id] || 'todo';
    byStatus[s].push(ws);
  }

  const handleDrop = (target: KanbanStatus, workspaceId: string) => {
    setStatus(workspaceId, target);
    setStatusMap({ ...statusMap, [workspaceId]: target });
  };

  return (
    <div className="h-full w-full grid grid-cols-1 gap-4 p-3 sm:grid-cols-3">
      {order.map((s) => (
        <KanbanColumn
          key={s}
          title={titles[s]}
          count={byStatus[s].length}
          onDropCard={(id) => handleDrop(s, id)}
        >
          {byStatus[s].length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">No items</div>
          ) : (
            byStatus[s].map((ws) => (
              <KanbanCard key={ws.id} ws={ws} onOpen={onOpenWorkspace} />
            ))
          )}
        </KanbanColumn>
      ))}
    </div>
  );
};

export default KanbanBoard;

