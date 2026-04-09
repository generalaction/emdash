import { observer } from 'mobx-react-lite';
import React from 'react';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useRightSidebar } from '@renderer/lib/ui/right-sidebar';
import CommandPalette from './CommandPalette';

type CommandPaletteModalProps = BaseModalProps<void>;

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = observer(
  function CommandPaletteModal({ onClose }) {
    const { toggleLeft: toggleLeftSidebar } = useWorkspaceLayoutContext();
    const { toggle: toggleRightSidebar } = useRightSidebar();
    const { toggleTheme } = useTheme();
    const { navigate } = useNavigate();

    const projects = Array.from(getProjectManagerStore().projects.values()).flatMap((project) =>
      project.data ? [project.data] : []
    );

    return (
      <CommandPalette
        isOpen={true}
        onClose={onClose}
        projects={projects}
        onSelectProject={(projectId) => {
          navigate('project', { projectId });
          onClose();
        }}
        onSelectTask={(projectId, taskId) => {
          navigate('task', { projectId, taskId });
          onClose();
        }}
        onOpenSettings={() => {
          navigate('settings');
          onClose();
        }}
        onOpenKeyboardShortcuts={() => {
          navigate('settings', { tab: 'interface' });
          onClose();
        }}
        onToggleLeftSidebar={() => {
          toggleLeftSidebar();
          onClose();
        }}
        onToggleRightSidebar={() => {
          toggleRightSidebar();
          onClose();
        }}
        onToggleTheme={() => {
          toggleTheme();
          onClose();
        }}
        onGoHome={() => {
          navigate('home');
          onClose();
        }}
        onOpenProject={() => {}}
      />
    );
  }
);
