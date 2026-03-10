import React, { useCallback, useEffect, useState } from 'react';
import type { Task } from '../../types/app';
import KanbanColumn from '../kanban/KanbanColumn';
import KanbanCard from '../kanban/KanbanCard';
import { Button } from '../ui/button';
import { Inbox, Plus } from 'lucide-react';
import {
  getAllContentStatuses,
  setContentStatus,
  parseKanbanColumns,
  type ContentColumn,
} from '../../lib/contentKanbanStore';

interface ContentKanbanBoardProps {
  tasks: Task[];
  /** JSON string of column definitions from workspace, or null for defaults */
  columnsJson?: string | null;
  onOpenTask?: (task: Task) => void;
  onCreateTask?: () => void;
}

export function ContentKanbanBoard({
  tasks,
  columnsJson,
  onOpenTask,
  onCreateTask,
}: ContentKanbanBoardProps) {
  const columns = parseKanbanColumns(columnsJson);
  const firstColumnId = columns[0]?.id || 'backlog';

  const [statusMap, setStatusMap] = useState<Record<string, string>>({});

  // Initialize status map on mount
  useEffect(() => {
    setStatusMap(getAllContentStatuses());
  }, []);

  // Handle dropping a card into a column
  const handleDrop = useCallback((targetColumn: string, taskId: string) => {
    setContentStatus(taskId, targetColumn);
    setStatusMap((prev) => ({ ...prev, [taskId]: targetColumn }));
  }, []);

  // Group tasks by column
  const tasksByColumn: Record<string, Task[]> = {};
  for (const col of columns) {
    tasksByColumn[col.id] = [];
  }
  for (const task of tasks) {
    const status = statusMap[task.id] || firstColumnId;
    if (tasksByColumn[status]) {
      tasksByColumn[status].push(task);
    } else {
      // If status doesn't match any column, put in first column
      tasksByColumn[firstColumnId]?.push(task);
    }
  }

  const hasAny = tasks.length > 0;

  return (
    <div
      className="grid h-full w-full gap-4 p-3"
      style={{
        gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
      }}
    >
      {columns.map((col, index) => (
        <KanbanColumn
          key={col.id}
          title={col.title}
          count={tasksByColumn[col.id]?.length || 0}
          onDropCard={(id) => handleDrop(col.id, id)}
          action={
            index === 0 && onCreateTask ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md border border-border/60 bg-muted text-foreground shadow-sm hover:bg-muted/80"
                onClick={onCreateTask}
                aria-label="New Task"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : undefined
          }
        >
          {(tasksByColumn[col.id]?.length || 0) === 0 ? (
            index === 0 && !hasAny && onCreateTask ? (
              <div className="flex h-full flex-col">
                <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-4 text-center text-sm text-muted-foreground">
                  <div className="mx-auto mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border/60 bg-background/60">
                    <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
                  </div>
                  <span className="ml-2">No items</span>
                </div>
                <div className="flex flex-1 items-center justify-center">
                  <Button variant="default" size="sm" onClick={onCreateTask}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    New Task
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-4 text-center text-sm text-muted-foreground">
                <div className="mx-auto mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border/60 bg-background/60">
                  <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
                <span className="ml-2">No items</span>
              </div>
            )
          ) : (
            <>
              {tasksByColumn[col.id]?.map((task) => (
                <KanbanCard key={task.id} ws={task} onOpen={onOpenTask} />
              ))}
              {index === 0 && onCreateTask ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full justify-center text-xs font-medium"
                  onClick={onCreateTask}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  New Task
                </Button>
              ) : null}
            </>
          )}
        </KanbanColumn>
      ))}
    </div>
  );
}

export default ContentKanbanBoard;
