import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { agentMeta } from '@renderer/lib/providers/meta';
import { appState } from '@renderer/lib/stores/app-state';
import { formatBytes } from '@renderer/utils/formatBytes';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type {
  ResourceAppProcess,
  ResourcePtyEntry,
  ResourceSnapshot,
} from '@shared/resource-monitor';

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

/**
 * Lifecycle-script PTYs are labelled by their terminal id (see
 * `createLifecycleScriptTerminalId`), which has no provider/conversation
 * metadata. Map those ids to friendly labels so they don't render as the
 * truncated "script-l…" leaf id.
 */
const LIFECYCLE_SCRIPT_LABELS: Record<string, string> = {
  'script-lifecycle-setup': 'Setup script',
  'script-lifecycle-run': 'Run script',
  'script-lifecycle-teardown': 'Teardown script',
};

export function isLifecycleScriptEntry(entry: Pick<Entry, 'leafId'>): boolean {
  return entry.leafId in LIFECYCLE_SCRIPT_LABELS;
}

/** Single source of truth for an entry's display label. */
export function entryLabel(entry: Entry): string {
  const meta = entry.providerId ? agentMeta[entry.providerId] : undefined;
  return (
    entry.conversationTitle ||
    meta?.label ||
    entry.providerId ||
    LIFECYCLE_SCRIPT_LABELS[entry.leafId] ||
    entry.leafId.slice(0, 8)
  );
}

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
        const path = `${g.projectName} / ${t.taskName} / ${entryLabel(e)}`;
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

export function buildGroups(entries: ResourcePtyEntry[]): Group[] {
  const projects = appState.projects.projects;
  const byProject = new Map<string, { projectName: string; tasks: Map<string, TaskBucket> }>();

  for (const entry of entries) {
    const projectStore = projects.get(entry.projectId);
    let taskName = entry.scopeId;
    // The bucket key normally matches the entry's scopeId, but lifecycle
    // scripts are scoped by workspaceId while agents are scoped by taskId.
    // Resolving both to the owning task id groups them under the same branch.
    let bucketKey = entry.scopeId;
    let providerId: AgentProviderId | undefined;
    let conversationTitle: string | undefined;
    let projectName = 'Other';
    let projectKey = UNKNOWN_PROJECT_ID;

    if (projectStore) {
      projectKey = entry.projectId;
      projectName = projectStore.name ?? projectStore.data?.name ?? entry.projectId.slice(0, 8);
      const mounted = projectStore.mountedProject;
      // Agent PTYs use the task id as scopeId; lifecycle-script PTYs use the
      // workspace id. Try the direct lookup first, then fall back to matching
      // a task by its workspaceId so scripts attach to their owning branch.
      let taskId = entry.scopeId;
      let task = mounted?.taskManager.tasks.get(entry.scopeId);
      if (!task && mounted) {
        for (const [id, candidate] of mounted.taskManager.tasks) {
          if (candidate.workspaceId === entry.scopeId) {
            taskId = id;
            task = candidate;
            break;
          }
        }
      }
      if (task) {
        bucketKey = taskId;
        taskName = task.displayName;
        const conv = conversationRegistry.get(taskId)?.conversations.get(entry.leafId);
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
    const taskBucket = project.tasks.get(bucketKey) ?? {
      scopeId: bucketKey,
      taskName,
      entries: [],
      cpuSum: 0,
    };
    taskBucket.entries.push({ ...entry, taskName, providerId, conversationTitle });
    taskBucket.cpuSum += entry.cpu;
    project.tasks.set(bucketKey, taskBucket);
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
