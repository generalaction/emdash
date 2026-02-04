import React from 'react';
import type { Project, Task } from '../../types/app';
import KanbanColumn from './KanbanColumn';
import KanbanCard from './KanbanCard';
import { Button } from '../ui/button';
import { Inbox, Plus } from 'lucide-react';
import { getAll, setStatus, type KanbanStatus } from '../../lib/kanbanStore';
import { subscribeDerivedStatus, watchTaskPty, watchTaskActivity } from '../../lib/taskStatus';
import { activityStore } from '../../lib/activityStore';
import { refreshPrStatus } from '../../lib/prStatusStore';

const order: KanbanStatus[] = ['todo', 'in-progress', 'done'];
const titles: Record<KanbanStatus, string> = {
  todo: 'To‑do',
  'in-progress': 'In‑progress',
  done: 'Ready for review',
};

const KanbanBoard: React.FC<{
  project: Project;
  onOpenTask?: (ws: Task) => void;
  onCreateTask?: () => void;
}> = ({ project, onOpenTask, onCreateTask }) => {
  const [statusMap, setStatusMap] = React.useState<Record<string, KanbanStatus>>({});

  React.useEffect(() => {
    setStatusMap(getAll());
  }, [project.id]);

  // Auto-promote to in-progress when derived status reports busy.
  React.useEffect(() => {
    const offs: Array<() => void> = [];
    const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const wsList = project.tasks || [];
    for (const ws of wsList) {
      // Watch PTY output to capture terminal-based providers as activity
      offs.push(watchTaskPty(ws.id));
      // Watch container run state as another activity source (build/start/ready)
      // Watch app-wide activity classification (matches left sidebar spinner)
      offs.push(watchTaskActivity(ws.id));
      const off = subscribeDerivedStatus(ws.id, (derived) => {
        if (derived !== 'busy') return;
        setStatusMap((prev) => {
          if (prev[ws.id] === 'in-progress') return prev;
          setStatus(ws.id, 'in-progress');
          return { ...prev, [ws.id]: 'in-progress' };
        });
      });
      offs.push(off);

      // Auto-complete: when activity goes idle, schedule move to Done after a grace period.
      const un = activityStore.subscribe(ws.id, (isBusy) => {
        const existing = idleTimers.get(ws.id);
        if (isBusy) {
          if (existing) {
            clearTimeout(existing);
            idleTimers.delete(ws.id);
          }
          return;
        }
        // schedule auto-move to done if currently in-progress
        if (existing) clearTimeout(existing);
        const t = setTimeout(() => {
          setStatusMap((prev) => {
            const cur = prev[ws.id] || 'todo';
            if (cur !== 'in-progress') return prev;
            setStatus(ws.id, 'done');
            return { ...prev, [ws.id]: 'done' };
          });
          idleTimers.delete(ws.id);
        }, 10_000);
        idleTimers.set(ws.id, t as any);
      });
      offs.push(un);
    }

    // Per-task: when the PTY exits and task is not busy anymore, move to Done
    for (const ws of wsList) {
      try {
        const offExit = (window as any).electronAPI.onPtyExit?.(
          ws.id,
          (_info: { exitCode: number; signal?: number }) => {
            let currentlyBusy = false;
            const un = activityStore.subscribe(ws.id, (b) => {
              currentlyBusy = b;
            });
            un?.();
            if (currentlyBusy) return;
            setStatusMap((prev) => {
              const cur = prev[ws.id] || 'todo';
              if (cur !== 'in-progress') return prev;
              setStatus(ws.id, 'done');
              return { ...prev, [ws.id]: 'done' };
            });
          }
        );
        if (offExit) offs.push(offExit);
      } catch {}
    }
    return () => offs.forEach((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.tasks?.length]);

  // Promote any task with local changes directly to "Ready for review" (done)
  React.useEffect(() => {
    let cancelled = false;
    const wsList = project.tasks || [];
    const check = async () => {
      for (const ws of wsList) {
        const variantPaths: string[] = (() => {
          try {
            const v = ws?.metadata?.multiAgent?.variants || [];
            if (Array.isArray(v)) return v.map((x: any) => String(x?.path || '')).filter(Boolean);
          } catch {}
          return [];
        })();
        const paths = [ws.path, ...variantPaths].filter((p, i, arr) => p && arr.indexOf(p) === i);
        if (paths.length === 0) continue;
        try {
          let hasChanges = false;
          for (const p of paths) {
            const res = await (window as any).electronAPI?.getGitStatus?.(p);
            if (res?.success && Array.isArray(res?.changes) && res.changes.length > 0) {
              hasChanges = true;
              break;
            }
          }
          if (hasChanges && !cancelled) {
            // Do not auto-complete while busy
            let currentlyBusy = false;
            const un = activityStore.subscribe(ws.id, (b) => {
              currentlyBusy = b;
            });
            un?.();
            if (currentlyBusy) continue;
            setStatusMap((prev) => {
              if (prev[ws.id] === 'done') return prev;
              setStatus(ws.id, 'done');
              return { ...prev, [ws.id]: 'done' };
            });
          }
        } catch {
          // ignore per-task errors
        }
      }
    };
    check();
    const id = window.setInterval(check, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [project.id, project.tasks?.length]);

  // Promote any task with an open PR to "Ready for review" (done)
  React.useEffect(() => {
    let cancelled = false;
    const wsList = project.tasks || [];
    const check = async () => {
      for (const ws of wsList) {
        const variantPaths: string[] = (() => {
          try {
            const v = ws?.metadata?.multiAgent?.variants || [];
            if (Array.isArray(v)) return v.map((x: any) => String(x?.path || '')).filter(Boolean);
          } catch {}
          return [];
        })();
        const paths = [ws.path, ...variantPaths].filter((p, i, arr) => p && arr.indexOf(p) === i);
        if (paths.length === 0) continue;
        try {
          let hasPr = false;
          for (const p of paths) {
            const pr = await refreshPrStatus(p);
            if (pr) {
              hasPr = true;
              break;
            }
          }
          if (hasPr && !cancelled) {
            // Do not auto-complete while busy
            let currentlyBusy = false;
            const un = activityStore.subscribe(ws.id, (b) => {
              currentlyBusy = b;
            });
            un?.();
            if (currentlyBusy) continue;
            setStatusMap((prev) => {
              if (prev[ws.id] === 'done') return prev;
              setStatus(ws.id, 'done');
              return { ...prev, [ws.id]: 'done' };
            });
          }
        } catch {
          // ignore
        }
      }
    };
    check();
    const id = window.setInterval(check, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [project.id, project.tasks?.length]);

  React.useEffect(() => {
    let cancelled = false;
    const wsList = project.tasks || [];
    const check = async () => {
      for (const ws of wsList) {
        const variantPaths: string[] = (() => {
          try {
            const v = ws?.metadata?.multiAgent?.variants || [];
            if (Array.isArray(v)) return v.map((x: any) => String(x?.path || '')).filter(Boolean);
          } catch {}
          return [];
        })();
        const paths = [ws.path, ...variantPaths].filter((p, i, arr) => p && arr.indexOf(p) === i);
        if (paths.length === 0) continue;
        try {
          let ahead = 0;
          for (const p of paths) {
            const res = await (window as any).electronAPI?.getBranchStatus?.({ taskPath: p });
            if (res?.success) {
              const a = Number(res?.ahead ?? 0);
              if (a > 0) {
                ahead = a;
                break;
              }
            }
          }
          if (ahead > 0 && !cancelled) {
            let currentlyBusy = false;
            const un = activityStore.subscribe(ws.id, (b) => {
              currentlyBusy = b;
            });
            un?.();
            if (currentlyBusy) continue;
            setStatusMap((prev) => {
              if (prev[ws.id] === 'done') return prev;
              setStatus(ws.id, 'done');
              return { ...prev, [ws.id]: 'done' };
            });
          }
        } catch {
          // ignore
        }
      }
    };
    check();
    const id = window.setInterval(check, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [project.id, project.tasks?.length]);

  const byStatus: Record<KanbanStatus, Task[]> = { todo: [], 'in-progress': [], done: [] };
  for (const ws of project.tasks || []) {
    const s = statusMap[ws.id] || 'todo';
    byStatus[s].push(ws);
  }
  const hasAny = (project.tasks?.length ?? 0) > 0;

  const handleDrop = (target: KanbanStatus, taskId: string) => {
    setStatus(taskId, target);
    setStatusMap({ ...statusMap, [taskId]: target });
  };

  return (
    <div className="grid h-full w-full grid-cols-1 gap-4 p-3 sm:grid-cols-3">
      {order.map((s) => (
        <KanbanColumn
          key={s}
          title={titles[s]}
          count={byStatus[s].length}
          onDropCard={(id) => handleDrop(s, id)}
          action={
            s === 'todo' && onCreateTask ? (
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
          {byStatus[s].length === 0 ? (
            s === 'todo' && !hasAny && onCreateTask ? (
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
              {byStatus[s].map((ws) => (
                <KanbanCard key={ws.id} ws={ws} onOpen={onOpenTask} />
              ))}
              {s === 'todo' && onCreateTask ? (
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
};

export default KanbanBoard;
