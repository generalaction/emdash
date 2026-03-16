import React from 'react';
import type { BaseModalProps } from '../core/modal/modal-provider';
import { useProjectsContext } from '../core/projects/project-provider';
import { useWorkspaceLayoutContext } from '../core/view/layout-provider';
import { useNavigate } from '../core/view/navigation-provider';
import { useTheme } from '../hooks/useTheme';
import CommandPalette from './CommandPalette';
import { useRightSidebar } from './ui/right-sidebar';

type CommandPaletteModalProps = BaseModalProps<void>;

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({ onClose }) => {
  const { toggleLeft: toggleLeftSidebar } = useWorkspaceLayoutContext();
  const { toggle: toggleRightSidebar } = useRightSidebar();
  const { toggleTheme } = useTheme();
  const { projects } = useProjectsContext();
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
