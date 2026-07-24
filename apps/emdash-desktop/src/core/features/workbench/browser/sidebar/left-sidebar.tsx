import { Clock, FolderInput, Library, MessageSquareShare, Settings } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { automationsViewDef } from '@core/features/automations/contributions/views';
import { libraryViewDef } from '@core/features/library/contributions/views';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { viewCatalog } from '@core/manifests/browser/view-catalog';
import { cn } from '@core/primitives/ui/browser/cn';
import { BoundShortcut } from '@core/primitives/ui/browser/shortcut';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import {
  isCurrentView,
  useNavigate,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { SidebarPinnedTaskList } from './pinned-task-list';
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
import { SidebarSearchTrigger } from './sidebar-search-trigger';
import { SidebarSpace } from './sidebar-space';
import { SidebarVirtualList } from './sidebar-virtual-list';
import { UpdateSection } from './update-section';
import { useSidebarDrop } from './use-sidebar-drop';

export const LeftSidebar: React.FC = observer(function LeftSidebar() {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { isLeftOpen } = useWorkspaceLayoutContext();

  const openFeedbackModal = useOpenModal('feedbackModal');
  const { isDragOver, onDragOver, onDragEnter, onDragLeave, onDrop } = useSidebarDrop();

  return (
    <div
      className={cn(
        'relative flex h-full flex-col bg-background-tertiary text-foreground-tertiary-muted transition-colors',
        isLeftOpen && 'border-r border-border',
        isDragOver && 'bg-accent/10 ring-2 ring-inset ring-accent/50'
      )}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-background-tertiary/80 backdrop-blur-sm">
          <FolderInput className="size-8 text-foreground" />
          <span className="text-xs font-medium text-foreground">Drop to add project</span>
        </div>
      )}
      <SidebarSpace />
      <SidebarContainer className="min-h-0 w-full flex-1 border-r-0">
        <SidebarContent className="flex flex-col">
          <SidebarPinnedTaskList />
          <SidebarGroup className="mb-0 flex min-h-0 flex-1 flex-col">
            <ProjectsGroupLabel />
            <SidebarGroupContent className="flex min-h-0 flex-1 flex-col">
              <SidebarMenu className="flex min-h-0 flex-1 flex-col">
                <SidebarVirtualList />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarSearchTrigger />
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'automations')}
              onClick={() => navigate(automationsViewDef())}
              aria-label="Automations"
              className="w-full justify-between"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Clock className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
                <span className="truncate">Automations</span>
              </span>
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={viewCatalog.byId(currentView)?.traits.has('library') ?? false}
              onClick={() => navigate(libraryViewDef())}
              aria-label="Library"
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <Library className="h-5 w-5 sm:h-4 sm:w-4" />
                Library
              </span>
              <BoundShortcut command="app.library" variant="keycaps" />
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'settings')}
              onClick={() => navigate(settingsViewDef())}
              aria-label="Settings"
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-5 w-5 sm:h-4 sm:w-4" />
                Settings
              </span>
              <BoundShortcut command="app.settings" variant="keycaps" />
            </SidebarMenuButton>
          </SidebarMenu>
        </SidebarFooter>
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <button
            type="button"
            className="flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-foreground-muted focus:outline-none focus-visible:outline-none"
            onClick={() => void openFeedbackModal({})}
          >
            <MessageSquareShare className="size-4 shrink-0" />
            <span className="truncate">Give feedback</span>
          </button>
          <UpdateSection />
        </div>
      </SidebarContainer>
    </div>
  );
});
