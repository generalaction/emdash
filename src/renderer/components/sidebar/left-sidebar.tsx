import { useVirtualizer } from '@tanstack/react-virtual';
import { FolderPlus, MessageSquareShare, Plug, Puzzle, Settings } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef } from 'react';
import { useGithubContext } from '@renderer/core/github-context-provider';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { appState, sidebarStore } from '@renderer/core/stores/app-state';
import { getTaskStore } from '@renderer/core/stores/task-selectors';
import {
  isCurrentView,
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/core/view/navigation-provider';
import { MicroLabel } from '../ui/label';
import ShortcutHint from '../ui/shortcut-hint';
import { SidebarProjectItem } from './project-item';
import { ProjectsGroupLabel } from './projects-group-label';
import {
  SidebarContainer,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
} from './sidebar-primitives';
import { SidebarSpace } from './sidebar-space';
import { SidebarTaskItem } from './task-item';

const ROW_HEIGHT = 32;

const SidebarVirtualList = observer(function SidebarVirtualList() {
  const rows = sidebarStore.sidebarRows;
  const { currentView } = useWorkspaceSlots();
  const { params: taskParams } = useParams('task');
  const { params: projectParams } = useParams('project');

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Expand the parent project when navigating to a task (not when `rows` changes —
  // otherwise collapsing while staying on that task would immediately re-expand).
  useEffect(() => {
    if (currentView !== 'task') return;
    const targetProjectId = taskParams.projectId;
    const targetTaskId = taskParams.taskId;
    if (!targetProjectId || !targetTaskId) return;
    const activeTask = getTaskStore(targetProjectId, targetTaskId);
    if (activeTask?.data.isPinned) return;
    sidebarStore.ensureProjectExpanded(targetProjectId);
  }, [currentView, taskParams.projectId, taskParams.taskId]);

  // Scroll the active project/task into view when navigation or row layout changes.
  useEffect(() => {
    let targetProjectId: string | null = null;
    let targetTaskId: string | null = null;

    if (currentView === 'task') {
      targetProjectId = taskParams.projectId;
      targetTaskId = taskParams.taskId;
    } else if (currentView === 'project') {
      targetProjectId = projectParams.projectId;
    }

    if (!targetProjectId) return;

    if (targetTaskId) {
      const activeTask = getTaskStore(targetProjectId, targetTaskId);
      if (activeTask?.data.isPinned) {
        return;
      }
    }

    const activeIndex = rows.findIndex((row) => {
      if (targetTaskId) {
        return (
          row.kind === 'task' && row.taskId === targetTaskId && row.projectId === targetProjectId
        );
      }
      return row.kind === 'project' && row.projectId === targetProjectId;
    });

    if (activeIndex >= 0) {
      virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
    }
  }, [
    currentView,
    taskParams.projectId,
    taskParams.taskId,
    projectParams.projectId,
    rows,
    virtualizer,
  ]);

  return (
    <div ref={scrollRef} className="overflow-y-auto min-h-0 flex-1 px-3 pt-1 pb-3">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const row = rows[vItem.index];
          if (!row) return null;
          const style: React.CSSProperties = {
            position: 'absolute',
            top: vItem.start,
            left: 0,
            width: '100%',
            height: `${vItem.size}px`,
          };
          if (row.kind === 'project') {
            return (
              <div key={row.projectId} style={style}>
                <SidebarProjectItem projectId={row.projectId} />
              </div>
            );
          }
          return (
            <div key={`${row.projectId}:${row.taskId}`} style={style}>
              <SidebarTaskItem projectId={row.projectId} taskId={row.taskId} />
            </div>
          );
        })}
      </div>
    </div>
  );
});

const SidebarPinnedTaskList = observer(function SidebarPinnedTaskList() {
  const entries = sidebarStore.pinnedSidebarEntries;
  if (entries.length === 0) return null;

  return (
    <SidebarGroup className="shrink-0">
      <div className="flex items-center justify-between pl-5 pr-2.5 h-[40px]">
        <MicroLabel className="text-foreground-tertiary-passive">Pinned</MicroLabel>
      </div>
      <SidebarMenu className="px-3 pb-2">
        {entries.map(({ projectId, taskId }) => (
          <SidebarTaskItem
            key={`${projectId}:${taskId}`}
            projectId={projectId}
            taskId={taskId}
            rowVariant="pinned"
          />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
});

export const LeftSidebar: React.FC = observer(function LeftSidebar() {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const appVersion = appState.appInfo.info.data?.appVersion;
  const { user: githubUser } = useGithubContext();

  const showAddProjectModal = useShowModal('addProjectModal');
  const showFeedbackModal = useShowModal('feedbackModal');

  return (
    <div className="flex flex-col h-full bg-background-tertiary text-foreground-tertiary-muted">
      <SidebarSpace />
      <SidebarContainer className="w-full border-r-0 flex-1 min-h-0">
        <SidebarContent className="flex flex-col">
          <SidebarPinnedTaskList />
          <SidebarGroup className="mb-0 min-h-0 flex-1 flex flex-col">
            <ProjectsGroupLabel />
            <SidebarGroupContent className="min-h-0 flex-1 flex flex-col">
              <SidebarMenu className="flex-1 min-h-0 flex flex-col">
                <SidebarVirtualList />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuButton
              isActive={false}
              onClick={() => showAddProjectModal({})}
              aria-label="Add Project"
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2 min-w-0 w-full">
                <FolderPlus className="h-5 w-5 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate min-w-0">Add Project</span>
              </span>
              <ShortcutHint settingsKey="newProject" />
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'skills')}
              onClick={() => navigate('skills')}
              aria-label="Skills"
              className="w-full justify-start"
            >
              <Puzzle className="h-5 w-5 sm:h-4 sm:w-4" />
              Skills
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'mcp')}
              onClick={() => navigate('mcp')}
              aria-label="MCP"
              className="w-full justify-start"
            >
              <Plug className="h-5 w-5 sm:h-4 sm:w-4" />
              MCP
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'settings')}
              onClick={() => navigate('settings')}
              aria-label="Settings"
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-5 w-5 sm:h-4 sm:w-4" />
                Settings
              </span>
              <ShortcutHint settingsKey="settings" />
            </SidebarMenuButton>
          </SidebarMenu>
        </SidebarFooter>
        <div className="flex items-center gap-2 justify-between px-3 py-2 border-t border-border">
          <button
            className="flex items-center min-w-0 w-full gap-2 text-sm text-foreground-muted hover:text-foreground px-3 py-1.5 rounded-md hover:bg-background-tertiary-1"
            onClick={() => showFeedbackModal({ githubUser })}
          >
            <MessageSquareShare className="size-4 shrink-0" />
            <span className="truncate">Give feedback</span>
          </button>

          {appVersion ? (
            <MicroLabel className="lowercase text-foreground-passive">v{appVersion}</MicroLabel>
          ) : null}
        </div>
      </SidebarContainer>
    </div>
  );
});
