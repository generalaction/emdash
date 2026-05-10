import type { AgentProviderId } from '@shared/agent-provider-registry';
import type {
  ResourceAppProcess,
  ResourcePtyEntry,
  ResourceSnapshot,
} from '@shared/resource-monitor';
import { agentMeta } from '@renderer/lib/providers/meta';
import { appState } from '@renderer/lib/stores/app-state';
import { formatBytes } from '@renderer/utils/formatBytes';

export type Entry = ResourcePtyEntry & {
  taskName?: string;
  providerId?: AgentProviderId;
  conversationTitle?: string;
};

export type TaskBucket = {
  scopeId: string;
  taskName: string;
  entries: Entry[];
  cpuSum: number;
};

export type Group = {
  projectId: string;
  projectName: string;
  tasks: TaskBucket[];
  entryCount: number;
};

const UNKNOWN_PROJECT_ID = '__unknown__';

export function formatReport(snapshot: ResourceSnapshot, groups: Group[]): string {
  const entryMem = snapshot.entries.reduce((n, e) => n + e.memory, 0);
  const entryCpu = snapshot.entries.reduce((n, e) => n + e.cpu, 0);
  const totalMem = snapshot.app.memoryBytes + entryMem;
  const totalCpuNorm =
    snapshot.cpuCount > 0 ? (snapshot.app.cpuPercent + entryCpu) / snapshot.cpuCount : 0;

  const lines: string[] = [];
  lines.push(`CPU ${totalCpuNorm.toFixed(1)}% Memory ${formatBytes(totalMem)}`);

  for (const proc of snapshot.appProcesses) {
    const label = appProcessLabel(proc.type, proc.name);
    const cpu = snapshot.cpuCount > 0 ? proc.cpu / snapshot.cpuCount : 0;
    lines.push(`${label} ${cpu.toFixed(1)}% ${formatBytes(proc.memory)} (pid=${proc.pid})`);
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
        const cpu = snapshot.cpuCount > 0 ? e.cpu / snapshot.cpuCount : 0;
        lines.push(`${path} ${cpu.toFixed(1)}% ${formatBytes(e.memory)}${suffix}`);
      }
    }
  }

  return lines.join('\n');
}

export function appProcessLabel(type: string, name?: string): string {
  if (type === 'Browser') return 'Main';
  if (type === 'Tab') return 'Renderer';
  if (type === 'GPU') return 'GPU';
  if (type === 'Zygote') return 'Zygote';
  if (type === 'Sandbox helper') return 'Sandbox';
  if (type === 'Utility') return name ?? 'Utility';
  return name ?? type;
}

export function sortAppProcesses(processes: ResourceAppProcess[]): ResourceAppProcess[] {
  return [...processes].sort((a, b) => {
    const labelCompare = appProcessLabel(a.type, a.name).localeCompare(
      appProcessLabel(b.type, b.name)
    );
    if (labelCompare !== 0) return labelCompare;
    return a.pid - b.pid;
  });
}

function entryLabel(entry: Entry): string {
  const meta = entry.providerId ? agentMeta[entry.providerId] : undefined;
  return entry.conversationTitle || meta?.label || entry.providerId || entry.leafId.slice(0, 8);
}

export function buildGroups(entries: ResourcePtyEntry[]): Group[] {
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

    // Fall back to metadata supplied by the sampler (covers cases where the
    // owning project isn't mounted, so the conversation join above misses).
    providerId ??= entry.providerId;
    conversationTitle ??= entry.title;

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
    for (const t of tasks) {
      t.entries.sort((a, b) => {
        const labelCompare = entryLabel(a).localeCompare(entryLabel(b));
        if (labelCompare !== 0) return labelCompare;
        return a.sessionId.localeCompare(b.sessionId);
      });
    }
    tasks.sort(
      (a, b) => a.taskName.localeCompare(b.taskName) || a.scopeId.localeCompare(b.scopeId)
    );
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
    return a.projectName.localeCompare(b.projectName) || a.projectId.localeCompare(b.projectId);
  });

  return groups;
}
