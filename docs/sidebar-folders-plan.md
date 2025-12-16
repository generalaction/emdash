# Sidebar Task Folders Implementation Plan

Issue: #390 - Worktree folders for short-term vs long-term tasks

## Goal

Allow users to organize tasks/workspaces into collapsible folders within each project.

## Proposed Structure

```
📂 Project (SidebarGroup + Collapsible)
├─ + Add Task
├─ 📁 Folder "Active" (Collapsible) [optional]
│  ├─ Task 1 (SidebarMenuSubItem)
│  └─ Task 2
├─ 📁 Folder "Backlog" (Collapsible) [optional]
│  └─ Task 3
├─ Task 4 (no folder - ungrouped)
└─ Task 5 (no folder - ungrouped)
```

## Implementation Steps

### Phase 1: UI Components ✅
- [x] Add `SidebarMenuSub`, `SidebarMenuSubItem`, `SidebarMenuSubButton` to `sidebar.tsx`

### Phase 2: Data Model ✅
- [x] Add `folder` field to workspace schema (`src/main/db/schema.ts`)
  ```typescript
  folder: text('folder'), // null = ungrouped, string = folder name
  ```
- [ ] Create migration for the new field
- [ ] Update `WorkspaceMetadata` type if needed
- [ ] Update `DatabaseService` to handle folder field

### Phase 3: Sidebar Rendering
- [ ] Update `LeftSidebar.tsx` to group workspaces by folder
- [ ] Render ungrouped tasks first (or last, TBD)
- [ ] Render each folder as a collapsible section with `SidebarMenuSub`
- [ ] Tasks inside folders use `SidebarMenuSubItem`

### Phase 4: Folder Management UI
- [ ] Add "Create Folder" button/option in project context menu
- [ ] Add "Move to Folder" context menu on tasks
- [ ] Allow renaming folders
- [ ] Allow deleting folders (moves tasks to ungrouped)

### Phase 5: Drag and Drop
- [ ] Enable dragging tasks between folders
- [ ] Enable dragging tasks out of folders (to ungrouped)
- [ ] Enable reordering tasks within folders
- [ ] Persist order in database

### Phase 6: Polish
- [ ] Remember folder collapsed/expanded state per project
- [ ] Add folder icons
- [ ] Keyboard navigation support

## Component Hierarchy

```tsx
<Collapsible> {/* Project */}
  <SidebarGroup>
    <SidebarGroupLabel>
      <CollapsibleTrigger>
        Project Name <ChevronDown />
      </CollapsibleTrigger>
    </SidebarGroupLabel>
    <CollapsibleContent>
      <SidebarGroupContent>
        <SidebarMenu>
          {/* Add Task button */}
          <SidebarMenuItem>...</SidebarMenuItem>

          {/* Ungrouped tasks */}
          <SidebarMenuItem>
            <WorkspaceItem />
          </SidebarMenuItem>

          {/* Folder */}
          <Collapsible>
            <SidebarMenuItem>
              <CollapsibleTrigger>
                <SidebarMenuButton>
                  Folder Name <ChevronDown />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <WorkspaceItem />
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        </SidebarMenu>
      </SidebarGroupContent>
    </CollapsibleContent>
  </SidebarGroup>
</Collapsible>
```

## Database Schema Change

```sql
ALTER TABLE workspaces ADD COLUMN folder TEXT;
```

## Notes

- Folders are per-project (not global)
- Folder names are simple strings (no separate folders table for MVP)
- Empty folders can exist (user created but no tasks assigned)
- Default folders could be suggested: "Active", "Backlog", "Done"
