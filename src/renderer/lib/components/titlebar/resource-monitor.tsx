import { Activity, Cpu, Folder, GitBranch, MemoryStick, Sparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { ResourcePtyEntry } from '@shared/resource-monitor';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { agentMeta } from '@renderer/lib/providers/meta';
import { appState } from '@renderer/lib/stores/app-state';
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
  const cpuLabel = `${store.totalCpuPercent.toFixed(0)}%`;
  const memLabel = formatBytes(store.totalMemoryBytes);

  const groups = useMemo(() => buildGroups(snapshot?.entries ?? []), [snapshot]);
  const hasAny = groups.length > 0;

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
                <Activity className="size-3.5" />
                <span>{cpuLabel}</span>
                <span className="text-foreground-passive">·</span>
                <span>{memLabel}</span>
              </Toggle>
            }
          />
        </TooltipTrigger>
        <TooltipContent>
          Resource monitor · {store.entryCount} {store.entryCount === 1 ? 'agent' : 'agents'}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="flex w-[22rem] flex-col gap-3 p-0">
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <MicroLabel className="text-foreground-passive">Totals</MicroLabel>
          <div className="grid grid-cols-3 gap-2">
            <TotalCard icon={<Cpu className="size-3.5" />} label="CPU" value={cpuLabel} />
            <TotalCard
              icon={<MemoryStick className="size-3.5" />}
              label="Memory"
              value={memLabel}
            />
            <TotalCard
              icon={<Activity className="size-3.5" />}
              label="Agents"
              value={String(store.entryCount)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1 px-3 pb-3">
          <MicroLabel className="text-foreground-passive">By project</MicroLabel>
          {hasAny ? (
            <div className="flex max-h-80 flex-col overflow-y-auto">
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

function TotalCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border p-2">
      <span className="flex items-center gap-1 text-[10px] text-foreground-passive">
        {icon}
        {label}
      </span>
      <span className="text-sm font-medium tabular-nums tracking-tight">{value}</span>
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
      <span className="flex size-4 shrink-0 items-center justify-center">
        {meta?.icon ? (
          <AgentLogo
            logo={meta.icon}
            alt={meta.label ?? meta.alt ?? ''}
            isSvg={meta.isSvg}
            invertInDark={meta.invertInDark}
            className="h-3.5 w-3.5"
          />
        ) : (
          <Sparkles className="size-3.5 text-foreground-passive" />
        )}
      </span>
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
