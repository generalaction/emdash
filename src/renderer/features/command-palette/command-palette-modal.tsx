import { observer } from 'mobx-react-lite';
import { useCallback, useMemo } from 'react';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal, type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import {
  Command,
  CommandEmpty,
  CommandGroup as CommandGroupUI,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@renderer/lib/ui/command';
import { Kbd, KbdGroup } from '@renderer/lib/ui/kbd';
import { useCommandItems, type CommandGroup, type CommandItemDef } from './use-command-items';

type Props = BaseModalProps<void>;

const GROUP_ORDER: CommandGroup[] = ['Navigation', 'Actions', 'Tasks', 'Projects'];

// Split on '+' only when it sits between two characters, so a literal '+' key
// (e.g. 'Ctrl++') survives as its own segment instead of producing an empty Kbd.
function splitShortcut(shortcut: string): string[] {
  return shortcut.split(/(?<=.)\+(?=.)/);
}

export const CommandPaletteModal = observer(function CommandPaletteModal({ onClose }: Props) {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { params: taskParams } = useParams('task');
  const { params: projectParams } = useParams('project');

  const showAddProject = useShowModal('addProjectModal');
  const showCreateTask = useShowModal('taskModal');
  const { toggleLeft, toggleRight } = useWorkspaceLayoutContext();
  const { toggleTheme } = useTheme();

  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : undefined;
  const currentTaskId = currentView === 'task' ? taskParams.taskId : undefined;

  const ctx = useMemo(
    () => ({
      navigate: {
        home: () => navigate('home'),
        settings: () => navigate('settings'),
        skills: () => navigate('skills'),
        mcp: () => navigate('mcp'),
        project: (projectId: string) => navigate('project', { projectId }),
        task: (projectId: string, taskId: string) => navigate('task', { projectId, taskId }),
      },
      showAddProject: () => showAddProject({ strategy: 'local', mode: 'pick' }),
      showCreateTask: (projectId: string) => showCreateTask({ projectId }),
      toggleLeftSidebar: toggleLeft,
      toggleRightSidebar: toggleRight,
      toggleTheme,
      currentProjectId,
      currentTaskId,
    }),
    [
      navigate,
      showAddProject,
      showCreateTask,
      toggleLeft,
      toggleRight,
      toggleTheme,
      currentProjectId,
      currentTaskId,
    ]
  );

  const items = useCommandItems(ctx);

  const grouped = useMemo(() => {
    const map = new Map<CommandGroup, CommandItemDef[]>();
    for (const group of GROUP_ORDER) map.set(group, []);
    for (const item of items) {
      map.get(item.group)?.push(item);
    }
    return map;
  }, [items]);

  const handleSelect = useCallback(
    (perform: () => void) => {
      // Close first so the next view/modal renders without z-index conflicts.
      onClose();
      // Defer the actual action to the next tick — letting the close animation
      // start and any pending state flush before we navigate or open another
      // modal. This keeps the palette feeling instant without visual jank.
      queueMicrotask(perform);
    },
    [onClose]
  );

  return (
    <Command
      // Filter is performed by cmdk; explicitly disable cmdk's auto-loop sort to
      // preserve our group order while still scoring matches.
      shouldFilter
      label="Command palette"
      className="min-h-[200px]"
    >
      <CommandInput autoFocus placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {GROUP_ORDER.map((group) => {
          const groupItems = grouped.get(group) ?? [];
          if (groupItems.length === 0) return null;
          return (
            <CommandGroupUI key={group} heading={group}>
              {groupItems.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.keywords?.join(' ') ?? ''}`}
                    onSelect={() => handleSelect(item.perform)}
                  >
                    {Icon ? <Icon className="size-4 text-foreground-muted" /> : null}
                    <span className="truncate">{item.label}</span>
                    {item.shortcut ? (
                      <CommandShortcut>
                        <KbdGroup>
                          {splitShortcut(item.shortcut).map((key, index) => (
                            <Kbd key={index}>{key.trim()}</Kbd>
                          ))}
                        </KbdGroup>
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroupUI>
          );
        })}
      </CommandList>
    </Command>
  );
});
