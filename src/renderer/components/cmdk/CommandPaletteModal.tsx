import { observer } from 'mobx-react-lite';
import React from 'react';
import { useRightSidebar } from '@renderer/components/ui/right-sidebar';
import type { BaseModalProps } from '@renderer/core/modal/modal-provider';
import { getProjectManagerStore } from '@renderer/core/stores/project-selectors';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { useTheme } from '@renderer/hooks/useTheme';
import CommandPalette from './CommandPalette';

type CommandPaletteModalProps = BaseModalProps<void>;

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = observer(
  function CommandPaletteModal({ onClose }) {
    const { toggleLeft: toggleLeftSidebar } = useWorkspaceLayoutContext();
    const { toggle: toggleRightSidebar } = useRightSidebar();
    const { toggleTheme } = useTheme();
    const { navigate } = useNavigate();

    const projects = Array.from(getProjectManagerStore().projects.values())
      .filter((p) => p.state === 'mounted' || p.state === 'unmounted')
      .map((p) => (p as { data: unknown }).data);

    return (
      <CommandPalette
        isOpen={true}
        onClose={onClose}
        projects={projects as any}
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
