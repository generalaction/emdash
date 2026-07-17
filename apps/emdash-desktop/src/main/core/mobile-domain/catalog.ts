import type { MobileCatalog, MobileResource } from '@emdash/core/mobile-access';
import { getConversations } from '@main/core/conversations/getConversations';
import { getProjects } from '@main/core/projects/operations/getProjects';
import { getTasks } from '@main/core/tasks/operations/getTasks';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { getAllTerminals } from '@main/core/terminals/getAllTerminals';
import { viewStateService } from '@main/core/view-state/view-state-service';
import type { TabDescriptor, TabGroupsSnapshot } from '@shared/view-state';

let catalogRevision = 0;
let catalogSignature = '';

export async function buildMobileCatalog(): Promise<MobileCatalog> {
  const [projects, allTasks, conversations, terminals] = await Promise.all([
    getProjects(),
    getTasks(),
    getConversations(),
    getAllTerminals(),
  ]);
  const tasks = allTasks.filter((task) => !task.archivedAt);
  const taskIds = new Set(tasks.map((task) => task.id));
  const resources: MobileResource[] = [];

  for (const conversation of conversations) {
    if (!taskIds.has(conversation.taskId)) continue;
    resources.push({
      kind: conversation.type === 'acp' ? 'acp' : 'conversation',
      id: conversation.id,
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      title: conversation.title,
      providerId: conversation.providerId,
      status: conversation.agentStatus ?? null,
      seen: conversation.agentStatusSeen ?? true,
      runtimeAvailable:
        taskSessionManager.getBootstrapStatus(conversation.taskId).status === 'ready',
    });
  }

  for (const terminal of terminals) {
    if (!taskIds.has(terminal.taskId)) continue;
    resources.push({
      kind: 'terminal',
      id: terminal.id,
      projectId: terminal.projectId,
      taskId: terminal.taskId,
      title: terminal.name,
      shellId: terminal.shellId,
      runtimeAvailable: taskSessionManager.getBootstrapStatus(terminal.taskId).status === 'ready',
    });
  }

  for (const task of tasks) {
    const snapshot = await viewStateService.get(`task:${task.id}:tabs`);
    for (const tab of browserTabs(snapshot)) {
      const url = tab.session.currentUrl;
      const openable = isOpenableBrowserUrl(url);
      resources.push({
        kind: 'browser',
        id: tab.browserId,
        projectId: task.projectId,
        taskId: task.id,
        title: tab.session.title || url || 'Browser',
        url,
        openable,
        ...(!openable ? { unavailableReason: browserUnavailableReason(url) } : {}),
      });
    }
  }

  const catalog = {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      kind: project.type,
    })),
    tasks: tasks.map((task) => {
      const bootstrap = taskSessionManager.getBootstrapStatus(task.id);
      return {
        id: task.id,
        projectId: task.projectId,
        name: task.name,
        lifecycleStatus: task.status,
        bootstrapStatus: bootstrap.status,
        ...(bootstrap.status === 'error' ? { bootstrapMessage: bootstrap.message } : {}),
        updatedAt: task.updatedAt,
      };
    }),
    resources,
  } satisfies Omit<MobileCatalog, 'revision'>;
  const nextSignature = JSON.stringify(catalog);
  if (nextSignature !== catalogSignature) {
    catalogSignature = nextSignature;
    catalogRevision += 1;
  }
  return { revision: catalogRevision, ...catalog };
}

function browserTabs(value: unknown): Extract<TabDescriptor, { kind: 'browser' }>[] {
  if (!isTabGroupsSnapshot(value)) return [];
  return value.groups.flatMap((group) =>
    group.tabManager.tabs.filter(
      (tab): tab is Extract<TabDescriptor, { kind: 'browser' }> => tab.kind === 'browser'
    )
  );
}

function isTabGroupsSnapshot(value: unknown): value is TabGroupsSnapshot {
  if (!value || typeof value !== 'object') return false;
  const groups = (value as { groups?: unknown }).groups;
  return (
    Array.isArray(groups) &&
    groups.every(
      (group) =>
        group &&
        typeof group === 'object' &&
        (group as { tabManager?: { tabs?: unknown } }).tabManager &&
        Array.isArray((group as { tabManager: { tabs: unknown } }).tabManager.tabs)
    )
  );
}

function isOpenableBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '::1';
  } catch {
    return false;
  }
}

function browserUnavailableReason(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
      return 'This address is local to the desktop and may not be reachable from the phone.';
    }
    return `The ${url.protocol} URL scheme cannot be opened on mobile.`;
  } catch {
    return 'The browser tab does not have a valid URL.';
  }
}
