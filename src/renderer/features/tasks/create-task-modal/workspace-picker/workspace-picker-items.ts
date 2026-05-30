import type { RepoInstance } from '@shared/projects';
import type { WorktreeEntry } from '@shared/workspaces';
import type { WorkspacePickerData } from './use-workspace-picker-data';


export type PickerHostItem = {
  type: 'host';
  hostKey: string;
  label: string;
  username?: string;
  connectionId?: string;
  kind: 'local' | 'ssh';
};

export type PickerRepoItem = {
  type: 'repo';
  instance: RepoInstance;
  mainEntry?: WorktreeEntry;
  taskCount: number;
  isPrimary: boolean;
};

export type PickerWorktreeItem = {
  type: 'worktree';
  entry: WorktreeEntry;
  instanceId: string;
  taskCount: number;
};

export type PickerItem = PickerHostItem | PickerRepoItem | PickerWorktreeItem;

export function repoInstanceName(instance: RepoInstance, mainEntry?: WorktreeEntry): string {
  if (instance.label) return instance.label;
  const path = mainEntry?.path ?? instance.path ?? '';
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? (instance.kind === 'byoi' ? 'Sandbox' : instance.kind);
}

export function buildPickerItems(
  data: WorkspacePickerData,
  options: { search?: string; includeWorktrees?: boolean }
): PickerItem[] {
  const { search = '', includeWorktrees = false } = options;
  const q = search.trim().toLowerCase();

  const {
    primaryWorktrees,
    instances,
    instanceWorktreeMap,
    taskCounts,
    systemInfo,
    connectionNameMap,
  } = data;

  const items: PickerItem[] = [];

  const mainEntry = primaryWorktrees?.find((e) => e.isMain);
  const primaryPath = mainEntry?.path ?? '';
  const linkedPrimary = primaryWorktrees?.filter((e) => !e.isMain) ?? [];

  const filteredPrimaryLinked = q
    ? linkedPrimary.filter(
        (e) => e.path.toLowerCase().includes(q) || (e.branch?.toLowerCase().includes(q) ?? false)
      )
    : linkedPrimary;

  // --- Local host ---
  const localInstances = (instances ?? []).filter((i) => i.kind === 'local');

  const localPrimaryMatches =
    !q ||
    primaryPath.toLowerCase().includes(q) ||
    (mainEntry?.branch?.toLowerCase().includes(q) ?? false) ||
    filteredPrimaryLinked.length > 0;

  const localSecondaryMatching = localInstances.filter((inst) => {
    if (!q) return true;
    const worktrees = instanceWorktreeMap[inst.id] ?? [];
    return worktrees.some(
      (e) => e.path.toLowerCase().includes(q) || (e.branch?.toLowerCase().includes(q) ?? false)
    );
  });

  if (localPrimaryMatches || localSecondaryMatching.length > 0) {
    items.push({
      type: 'host',
      hostKey: 'local',
      label: 'This machine',
      username: systemInfo?.hostname,
      kind: 'local',
    });

    // Primary instance
    if (localPrimaryMatches) {
      const primaryInstance: RepoInstance = {
        id: 'primary',
        projectId: '',
        label: null,
        kind: 'local',
        connectionId: null,
        path: primaryPath,
        remoteUrl: null,
        isFork: false,
        isPrimary: true,
        createdAt: '',
        updatedAt: '',
      };

      items.push({
        type: 'repo',
        instance: primaryInstance,
        mainEntry,
        taskCount: taskCounts?.[primaryPath] ?? 0,
        isPrimary: true,
      });

      if (includeWorktrees) {
        for (const entry of filteredPrimaryLinked) {
          items.push({
            type: 'worktree',
            entry,
            instanceId: 'primary',
            taskCount: taskCounts?.[entry.path] ?? 0,
          });
        }
      }
    }

    // Local secondary instances
    for (const inst of localSecondaryMatching) {
      const allWorktrees = instanceWorktreeMap[inst.id] ?? [];
      const instMainEntry = allWorktrees.find((e) => e.isMain);
      const linkedWorktrees = allWorktrees.filter((e) => !e.isMain);
      const filteredLinked = q
        ? linkedWorktrees.filter(
            (e) =>
              e.path.toLowerCase().includes(q) || (e.branch?.toLowerCase().includes(q) ?? false)
          )
        : linkedWorktrees;

      items.push({
        type: 'repo',
        instance: inst,
        mainEntry: instMainEntry,
        taskCount: taskCounts?.[instMainEntry?.path ?? inst.path ?? ''] ?? 0,
        isPrimary: false,
      });

      if (includeWorktrees) {
        for (const entry of filteredLinked) {
          items.push({
            type: 'worktree',
            entry,
            instanceId: inst.id,
            taskCount: taskCounts?.[entry.path] ?? 0,
          });
        }
      }
    }
  }

  // --- SSH hosts ---
  const sshGroups = new Map<string, RepoInstance[]>();
  for (const inst of instances ?? []) {
    if (inst.kind === 'ssh' && inst.connectionId) {
      const existing = sshGroups.get(inst.connectionId) ?? [];
      sshGroups.set(inst.connectionId, [...existing, inst]);
    }
  }

  for (const [connectionId, sshInstances] of sshGroups) {
    const matchingSshInstances = sshInstances.filter((inst) => {
      if (!q) return true;
      const worktrees = instanceWorktreeMap[inst.id] ?? [];
      return worktrees.some(
        (e) => e.path.toLowerCase().includes(q) || (e.branch?.toLowerCase().includes(q) ?? false)
      );
    });

    if (matchingSshInstances.length === 0) continue;

    const connName = connectionNameMap[connectionId] ?? connectionId;
    items.push({
      type: 'host',
      hostKey: `ssh:${connectionId}`,
      label: connName,
      connectionId,
      kind: 'ssh',
    });

    for (const inst of matchingSshInstances) {
      const allWorktrees = instanceWorktreeMap[inst.id] ?? [];
      const instMainEntry = allWorktrees.find((e) => e.isMain);
      const linkedWorktrees = allWorktrees.filter((e) => !e.isMain);
      const filteredLinked = q
        ? linkedWorktrees.filter(
            (e) =>
              e.path.toLowerCase().includes(q) || (e.branch?.toLowerCase().includes(q) ?? false)
          )
        : linkedWorktrees;

      items.push({
        type: 'repo',
        instance: inst,
        mainEntry: instMainEntry,
        taskCount: taskCounts?.[instMainEntry?.path ?? inst.path ?? ''] ?? 0,
        isPrimary: false,
      });

      if (includeWorktrees) {
        for (const entry of filteredLinked) {
          items.push({
            type: 'worktree',
            entry,
            instanceId: inst.id,
            taskCount: taskCounts?.[entry.path] ?? 0,
          });
        }
      }
    }
  }

  return items;
}
