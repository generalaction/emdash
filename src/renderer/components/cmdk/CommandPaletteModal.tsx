import React from 'react';
import { useRightSidebar } from '@renderer/components/ui/right-sidebar';
import type { BaseModalProps } from '@renderer/core/modal/modal-provider';
import { useProjectsDataContext } from '@renderer/core/projects/projects-data-provider';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { useTheme } from '@renderer/hooks/useTheme';
import CommandPalette from './CommandPalette';

type CommandPaletteModalProps = BaseModalProps<void>;

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({ onClose }) => {
  const { toggleLeft: toggleLeftSidebar } = useWorkspaceLayoutContext();
  const { toggle: toggleRightSidebar } = useRightSidebar();
  const { toggleTheme } = useTheme();
  const { projects } = useProjectsDataContext();
  const { navigate } = useNavigate();

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
};
