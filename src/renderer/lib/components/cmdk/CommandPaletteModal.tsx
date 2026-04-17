import { observer } from 'mobx-react-lite';
import React, { useCallback } from 'react';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal, type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useRightSidebar } from '@renderer/lib/ui/right-sidebar';
import { log } from '@renderer/utils/logger';
import CommandPalette from './CommandPalette';

type CommandPaletteModalProps = BaseModalProps<void>;

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = observer(
  function CommandPaletteModal({ onClose }) {
    const { toggleLeft: toggleLeftSidebar } = useWorkspaceLayoutContext();
    const { toggle: toggleRightSidebar } = useRightSidebar();
    const { toggleTheme } = useTheme();
    const { navigate } = useNavigate();
    const { value: localProjectSettings } = useAppSettingsKey('localProject');

    const showAddProjectModal = useShowModal('addProjectModal');

    const projects = Array.from(getProjectManagerStore().projects.values()).flatMap(
      (projectStore) => {
        const data = projectStore.data;
        if (!data) return [];
        const mounted = asMounted(projectStore);
        const tasks = mounted
          ? Array.from(mounted.taskManager.tasks.values())
              .filter((t) => !('archivedAt' in t.data) || !t.data.archivedAt)
              .map((t) => ({
                id: t.data.id,
                name: t.data.name,
                branch: ('taskBranch' in t.data && t.data.taskBranch) || '',
              }))
          : undefined;
        return [{ id: data.id, name: data.name, path: data.path, tasks }];
      }
    );

    const handleImportProject = useCallback(async () => {
      try {
        const picked = await rpc.app.openSelectDirectoryDialog({
          title: 'Import project',
          message: 'Choose a folder to import as a project',
          defaultPath: localProjectSettings?.defaultProjectsDirectory,
        });
        if (!picked) return;

        const existing = await rpc.projects.getLocalProjectByPath(picked);
        if (existing) {
          navigate('project', { projectId: existing.id });
          return;
        }

        const status = await rpc.projects.getLocalProjectPathStatus(picked);
        if (status?.isDirectory && status.isGitRepo === false) {
          showAddProjectModal({ strategy: 'local', mode: 'pick' });
          return;
        }

        const name = picked.split('/').filter(Boolean).pop() ?? 'project';
        const id = crypto.randomUUID();
        await getProjectManagerStore().createProject(
          { type: 'local' },
          { mode: 'pick', name, path: picked },
          id
        );
        navigate('project', { projectId: id });
      } catch (err) {
        log.error('Import project failed', err);
      }
    }, [navigate, showAddProjectModal, localProjectSettings?.defaultProjectsDirectory]);

    return (
      <CommandPalette
        onClose={onClose}
        projects={projects}
        onSelectProject={(projectId) => navigate('project', { projectId })}
        onSelectTask={(projectId, taskId) => navigate('task', { projectId, taskId })}
        onOpenSettings={() => navigate('settings')}
        onOpenKeyboardShortcuts={() => navigate('settings', { tab: 'interface' })}
        onToggleLeftSidebar={toggleLeftSidebar}
        onToggleRightSidebar={toggleRightSidebar}
        onToggleTheme={toggleTheme}
        onGoHome={() => navigate('home')}
        onAddProject={() => showAddProjectModal({ strategy: 'local', mode: 'pick' })}
        onImportProject={() => void handleImportProject()}
      />
    );
  }
);
