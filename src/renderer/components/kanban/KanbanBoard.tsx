import React from 'react';
import type { Project, Workspace } from '../../types/app';
import KanbanColumn from './KanbanColumn';
import KanbanCard from './KanbanCard';
import { getAll, getStatus, setStatus, type KanbanStatus } from '../../lib/kanbanStore';
import {
  subscribeDerivedStatus,
  watchWorkspacePty,
  watchWorkspaceContainers,
  watchWorkspaceActivity,
} from '../../lib/workspaceStatus';
import { activityStore } from '../../lib/activityStore';

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

  // Auto-promote to in-progress when derived status reports busy.
  React.useEffect(() => {
    const offs: Array<() => void> = [];
    const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const wsList = project.workspaces || [];
    const wsIds = new Set(wsList.map((w) => w.id));
    for (const ws of wsList) {
      // Watch PTY output to capture terminal-based providers as activity
      offs.push(watchWorkspacePty(ws.id));
      // Watch container run state as another activity source (build/start/ready)
      offs.push(watchWorkspaceContainers(ws.id));
      // Watch app-wide activity classification (matches left sidebar spinner)
      offs.push(watchWorkspaceActivity(ws.id));
      const off = subscribeDerivedStatus(ws.id, (derived) => {
        if (derived !== 'busy') return;
        // Guard with current state at the time of update
        setStatusMap((prev) => {
          const cur = prev[ws.id] || 'todo';
          if (cur === 'done' || cur === 'in-progress') return prev;
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

    // Global: when an agent stream completes for one of our workspaces, move to Done
    try {
      const offAgentDone = (window as any).electronAPI.onAgentStreamComplete?.(
        (data: { providerId: 'codex' | 'claude'; workspaceId: string; exitCode: number }) => {
          const wid = String(data?.workspaceId || '');
          if (!wsIds.has(wid)) return;
          // Only auto-complete if not currently busy according to the shared activity store
          let currentlyBusy = false;
          const un = activityStore.subscribe(wid, (b) => {
            currentlyBusy = b;
          });
          un?.();
          if (currentlyBusy) return;
          setStatusMap((prev) => {
            const cur = prev[wid] || 'todo';
            if (cur !== 'in-progress') return prev;
            setStatus(wid, 'done');
            return { ...prev, [wid]: 'done' };
          });
        }
      );
      if (offAgentDone) offs.push(offAgentDone);
    } catch {}

    // Per-ws: when the PTY exits and workspace is not busy anymore, move to Done
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
  }, [project.id, project.workspaces?.length]);

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
