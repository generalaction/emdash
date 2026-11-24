import { ContextMenu, MicroLabel } from '@emdash/ui/react/primitives';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  FolderPlus,
  Folders,
  Pencil,
  Trash2,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { cn } from '@core/primitives/styling/browser/cn';
import { SidebarItemMiniButton, SidebarMenuAction, SidebarMenuRow } from './sidebar-primitives';

/** Section header for a user-defined project group. Clicking the row toggles collapse. */
export const SidebarProjectGroupItem = observer(function SidebarProjectGroupItem({
  groupId,
}: {
  groupId: string;
}) {
  const openGroupNameModal = useOpenModal('projectGroupNameModal');
  const sidebar = getSidebarStore();
  const groups = sidebar.projectGroups;
  const index = groups.findIndex((g) => g.id === groupId);
  const group = groups[index];
  if (!group) return null;

  const isCollapsed = sidebar.isGroupCollapsed(groupId);
  const projectCount =
    sidebar.projectSections.find((section) => section.group?.id === groupId)?.projectIds.length ??
    0;
  const toggle = () => sidebar.toggleGroupCollapsed(groupId);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <SidebarMenuRow
          className="group/row h-8 gap-1 px-1"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggle}
        >
          <SidebarItemMiniButton
            type="button"
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} group ${group.name}`}
            aria-expanded={!isCollapsed}
            className="relative"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
          >
            {/* Like a project row: the group icon turns into the chevron on hover. */}
            <Folders className="absolute h-4 w-4 opacity-100 transition-opacity duration-150 group-hover/row:opacity-0" />
            <ChevronRight
              className={cn(
                'absolute h-4 w-4 opacity-0 transition-all duration-150 group-hover/row:opacity-100',
                !isCollapsed && 'rotate-90'
              )}
            />
          </SidebarItemMiniButton>
          <SidebarMenuAction aria-label={`Group ${group.name}`} className="gap-2">
            <span className="truncate text-foreground-tertiary">{group.name}</span>
            <MicroLabel className="ml-auto pr-2 text-foreground-tertiary-passive tabular-nums">
              {projectCount}
            </MicroLabel>
          </SidebarMenuAction>
        </SidebarMenuRow>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item
          onClick={() =>
            void openGroupNameModal({ mode: 'rename', groupId, currentName: group.name })
          }
        >
          <Pencil className="size-4" />
          Rename Group
        </ContextMenu.Item>
        <ContextMenu.Item disabled={index === 0} onClick={() => sidebar.moveGroup(groupId, -1)}>
          <ArrowUp className="size-4" />
          Move Up
        </ContextMenu.Item>
        <ContextMenu.Item
          disabled={index === groups.length - 1}
          onClick={() => sidebar.moveGroup(groupId, 1)}
        >
          <ArrowDown className="size-4" />
          Move Down
        </ContextMenu.Item>
        <ContextMenu.Item onClick={() => void openGroupNameModal({ mode: 'create' })}>
          <FolderPlus className="size-4" />
          New Group
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item variant="destructive" onClick={() => sidebar.deleteGroup(groupId)}>
          <Trash2 className="size-4" />
          Delete Group (keep projects)
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
});
