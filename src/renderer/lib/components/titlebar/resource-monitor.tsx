import { Check, Copy, Folder, Gauge, GitBranch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type {
  ResourceAppProcess,
  ResourcePtyEntry,
  ResourceSnapshot,
} from '@shared/resource-monitor';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { agentMeta } from '@renderer/lib/providers/meta';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Toggle } from '@renderer/lib/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatBytes } from '@renderer/utils/formatBytes';

type Entry = ResourcePtyEntry & {
  taskName?: string;
  providerId?: AgentProviderId;
  conversationTitle?: string;
};

type TaskBucket = {
  scopeId: string;
  taskName: string;
  entries: Entry[];
  cpuSum: number;
};

type Group = {
  projectId: string;
  projectName: string;
  tasks: TaskBucket[];
  entryCount: number;
};

const UNKNOWN_PROJECT_ID = '__unknown__';

export const ResourceMonitor = observer(function ResourceMonitor() {
  const store = appState.resourceMonitor;
  const snapshot = store.snapshot;
  const memLabel = formatBytes(store.totalMemoryBytes);
  const cpuLabel = `${store.totalCpuPercent.toFixed(1)}%`;

  const groups = useMemo(() => buildGroups(snapshot?.entries ?? []), [snapshot]);
  const processes = useMemo(
    () => [...(snapshot?.appProcesses ?? [])].sort((a, b) => b.memory - a.memory),
    [snapshot]
  );
  const hasAny = groups.length > 0;
  const hasProcesses = processes.length > 0;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger>
          <PopoverTrigger
            render={
              <Toggle
                size="sm"
                variant="outline"
                aria-label="Resource monitor"
                className="mr-1 gap-1.5 px-2 text-xs font-medium tabular-nums"
              >
                <Gauge className="size-3.5" />
                <span>{memLabel}</span>
              </Toggle>
            }
          />
        </TooltipTrigger>
        <TooltipContent>
          Resource monitor · {store.entryCount} {store.entryCount === 1 ? 'agent' : 'agents'}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="flex w-[24rem] flex-col gap-0 p-0">
        <div className="flex items-start justify-between gap-2 border-b border-border p-3">
          <div className="flex flex-col gap-1">
            <MicroLabel className="text-foreground-passive">Resources</MicroLabel>
            <div className="text-sm tabular-nums tracking-tight">
              <span className="text-foreground-passive">CPU </span>
              <span className="font-medium">{cpuLabel}</span>
              <span className="ml-3 text-foreground-passive">Memory </span>
              <span className="font-medium">{memLabel}</span>
            </div>
          </div>
          <CopyReportButton snapshot={snapshot} groups={groups} />
        </div>

        {hasProcesses ? (
          <div className="flex flex-col px-3 pb-2 pt-2">
            <ProcessTableHeader />
            <div className="flex max-h-44 flex-col overflow-y-auto">
              {processes.map((p) => (
                <ProcessRow key={p.pid} process={p} />
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-1 border-t border-border px-3 pb-3 pt-2">
          <MicroLabel className="text-foreground-passive">By project</MicroLabel>
          {hasAny ? (
            <div className="flex max-h-72 flex-col overflow-y-auto">
              {groups.map((g) => (
                <ProjectNode key={g.projectId} group={g} />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-border py-6 text-center text-xs text-foreground-passive">
              No active agents
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});

function ProcessTableHeader() {
  return (
    <div className="grid grid-cols-[1fr_3.5rem_4.5rem] items-center gap-2 px-1 pb-1 text-[10px] uppercase tracking-wider text-foreground-passive">
      <span>Name</span>
      <span className="text-right">CPU</span>
      <span className="text-right">Mem</span>
    </div>
  );
}

function ProcessRow({ process }: { process: ResourceAppProcess }) {
  const label = appProcessLabel(process.type, process.name);
  return (
    <div
      className="grid grid-cols-[1fr_3.5rem_4.5rem] items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-muted/40"
      title={`pid ${process.pid}`}
    >
      <span className="truncate text-foreground-muted">{label}</span>
      <span className="text-right tabular-nums text-foreground-passive">
        {process.cpu.toFixed(1)}%
      </span>
      <span className="text-right tabular-nums text-foreground-passive">
        {formatBytes(process.memory)}
      </span>
    </div>
  );
}

const ProjectNode = observer(function ProjectNode({ group }: { group: Group }) {
  return (
    <div className="flex flex-col py-1">
      <div className="flex items-center gap-1.5 px-1 py-0.5">
        <Folder className="size-3.5 text-foreground-passive" />
        <span className="flex-1 truncate text-xs font-medium tracking-tight">
          {group.projectName}
        </span>
        <span className="text-[10px] tabular-nums text-foreground-passive">{group.entryCount}</span>
      </div>
      <div className="ml-[9px] flex flex-col border-l border-border pl-2">
        {group.tasks.map((task) => (
          <TaskNode key={task.scopeId} task={task} />
        ))}
      </div>
    </div>
  );
});

function TaskNode({ task }: { task: TaskBucket }) {
  return (
    <div className="flex flex-col py-0.5">
      <div className="flex items-center gap-1.5 px-1 py-0.5">
        <GitBranch className="size-3 text-foreground-passive" />
        <span className="flex-1 truncate text-xs text-foreground-muted">{task.taskName}</span>
        <span className="text-[10px] tabular-nums text-foreground-passive">
          {task.entries.length}
        </span>
      </div>
      <div className="ml-[7px] flex flex-col border-l border-border pl-2">
        {task.entries.map((entry) => (
          <AgentRow key={entry.sessionId} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function AgentRow({ entry }: { entry: Entry }) {
  const norm = appState.resourceMonitor.normalizedCpu(entry);
  const meta = entry.providerId ? agentMeta[entry.providerId] : undefined;
  const label =
    entry.conversationTitle || meta?.label || entry.providerId || entry.leafId.slice(0, 8);

  return (
    <div
      className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-muted/40"
      title={entry.sessionId}
    >
      {meta?.icon ? (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <AgentLogo
            logo={meta.icon}
            alt={meta.label ?? meta.alt ?? ''}
            isSvg={meta.isSvg}
            invertInDark={meta.invertInDark}
            className="h-3.5 w-3.5"
          />
        </span>
      ) : null}
      <div className="min-w-0 flex-1 truncate">
        <span className="truncate text-foreground-muted">{label}</span>
        {entry.pid === undefined ? (
          <span className="ml-1 text-[10px] text-foreground-passive">(ssh)</span>
        ) : null}
      </div>
      <span className="tabular-nums text-foreground-passive">
        {norm.toFixed(0)}% · {formatBytes(entry.memory)}
      </span>
    </div>
  );
}

function CopyReportButton({
  snapshot,
  groups,
}: {
  snapshot: ResourceSnapshot | null;
  groups: Group[];
}) {
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetRef.current !== null) window.clearTimeout(resetRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!snapshot || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    const text = formatReport(snapshot, groups);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (resetRef.current !== null) window.clearTimeout(resetRef.current);
      resetRef.current = window.setTimeout(() => {
        setCopied(false);
        resetRef.current = null;
      }, 1500);
    } catch {
      setCopied(false);
    }
  }, [snapshot, groups]);

  return (
    <Tooltip>
      <TooltipTrigger>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy resource report"
          onClick={handleCopy}
          disabled={!snapshot}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied' : 'Copy report'}</TooltipContent>
    </Tooltip>
  );
}

function formatReport(snapshot: ResourceSnapshot, groups: Group[]): string {
  const totalMem =
    (snapshot.app?.memoryBytes ?? 0) + snapshot.entries.reduce((n, e) => n + e.memory, 0);
  const totalCpuNorm =
    snapshot.cpuCount > 0
      ? ((snapshot.app?.cpuPercent ?? 0) + snapshot.entries.reduce((n, e) => n + e.cpu, 0)) /
        snapshot.cpuCount
      : 0;

  const lines: string[] = [];
  lines.push(`CPU ${totalCpuNorm.toFixed(1)}% Memory ${formatBytes(totalMem)}`);

  for (const proc of snapshot.appProcesses ?? []) {
    const label = appProcessLabel(proc.type, proc.name);
    const parts = [`pid=${proc.pid}`];
    lines.push(`${label} ${proc.cpu.toFixed(1)}% ${formatBytes(proc.memory)} (${parts.join(' ')})`);
  }

  for (const g of groups) {
    for (const t of g.tasks) {
      for (const e of t.entries) {
        const meta = e.providerId ? agentMeta[e.providerId] : undefined;
        const label = e.conversationTitle || meta?.label || e.providerId || e.leafId.slice(0, 8);
        const path = `${g.projectName} / ${t.taskName} / ${label}`;
        const parts: string[] = [];
        if (e.pid !== undefined) parts.push(`pid=${e.pid}`);
        if (e.ppid !== undefined) parts.push(`ppid=${e.ppid}`);
        if (e.pid === undefined) parts.push('ssh');
        const suffix = parts.length > 0 ? ` (${parts.join(' ')})` : '';
        lines.push(`${path} ${e.cpu.toFixed(1)}% ${formatBytes(e.memory)}${suffix}`);
      }
    }
  }

  return lines.join('\n');
}

function appProcessLabel(type: string, name?: string): string {
  if (type === 'Browser') return 'Main';
  if (type === 'Tab') return 'Renderer';
  if (type === 'GPU') return 'GPU';
  if (type === 'Zygote') return 'Zygote';
  if (type === 'Sandbox helper') return 'Sandbox';
  if (type === 'Utility') return name ?? 'Utility';
  return name ?? type;
}

function buildGroups(entries: ResourcePtyEntry[]): Group[] {
  const projects = appState.projects.projects;
  const byProject = new Map<string, { projectName: string; tasks: Map<string, TaskBucket> }>();

  for (const entry of entries) {
    const projectStore = projects.get(entry.projectId);
    let taskName = entry.scopeId;
    let providerId: AgentProviderId | undefined;
    let conversationTitle: string | undefined;
    let projectName = 'Other';
    let projectKey = UNKNOWN_PROJECT_ID;

    if (projectStore) {
      projectKey = entry.projectId;
      projectName = projectStore.name ?? projectStore.data?.name ?? entry.projectId.slice(0, 8);
      const mounted = projectStore.mountedProject;
      const task = mounted?.taskManager.tasks.get(entry.scopeId);
      if (task) {
        taskName = task.displayName;
        const conv = task.provisionedTask?.conversations.conversations.get(entry.leafId);
        providerId = conv?.data.providerId;
        conversationTitle = conv?.data.title;
      }
    }

    const project = byProject.get(projectKey) ?? {
      projectName,
      tasks: new Map<string, TaskBucket>(),
    };
    const taskBucket = project.tasks.get(entry.scopeId) ?? {
      scopeId: entry.scopeId,
      taskName,
      entries: [],
      cpuSum: 0,
    };
    taskBucket.entries.push({ ...entry, taskName, providerId, conversationTitle });
    taskBucket.cpuSum += entry.cpu;
    project.tasks.set(entry.scopeId, taskBucket);
    byProject.set(projectKey, project);
  }

  const groups: Group[] = Array.from(byProject.entries()).map(([projectId, p]) => {
    const tasks = Array.from(p.tasks.values());
    for (const t of tasks) t.entries.sort((a, b) => b.cpu - a.cpu);
    tasks.sort((a, b) => b.cpuSum - a.cpuSum || a.taskName.localeCompare(b.taskName));
    return {
      projectId,
      projectName: p.projectName,
      tasks,
      entryCount: tasks.reduce((n, t) => n + t.entries.length, 0),
    };
  });

  // Keep the "Other" bucket at the end so real projects render first.
  groups.sort((a, b) => {
    if (a.projectId === UNKNOWN_PROJECT_ID) return 1;
    if (b.projectId === UNKNOWN_PROJECT_ID) return -1;
    return 0;
  });

  return groups;
}
