import { useHotkey } from '@tanstack/react-hotkeys';
import React from 'react';
import { useAppSettingsKey } from '@renderer/contexts/AppSettingsProvider';
import { useRightSidebar } from '../components/ui/right-sidebar';
import { useModalContext } from '../core/modal-provider';
import { useWorkspaceLayoutContext } from '../core/view/layout-provider';
import { useNavigate, useWorkspaceSlots } from '../core/view/navigation-provider';
import { getEffectiveHotkey, type ShortcutSettingsKey } from '../hooks/useKeyboardShortcuts';
import { useTheme } from '../hooks/useTheme';

const AppKeyboardShortcuts: React.FC = () => {
  const { toggleLeft: toggleLeftSidebar } = useWorkspaceLayoutContext();
  const { toggle: toggleRightSidebar } = useRightSidebar();
  const { toggleTheme } = useTheme();
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const { showModal, activeModalId, closeModal } = useModalContext();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();

  const isCommandPaletteOpen = activeModalId === 'commandPaletteModal';
  const isSettingsOpen = currentView === 'settings';

  const ek = (key: ShortcutSettingsKey) => getEffectiveHotkey(key, keyboard);

  // Command palette: fires from input fields too
  useHotkey(ek('commandPalette'), () => showModal('commandPaletteModal', {}), {
    ignoreInputs: false,
    conflictBehavior: 'allow',
  });
  // View / navigation shortcuts — if command palette is open, close it first then run
  const withCommandPaletteClose = (fn: () => void) => () => {
    if (isCommandPaletteOpen) {
      closeModal();
      setTimeout(fn, 100);
    } else {
      fn();
    }
  };

  useHotkey(
    ek('settings'),
    withCommandPaletteClose(() => navigate('settings')),
    {
      enabled: !isSettingsOpen || isCommandPaletteOpen,
      conflictBehavior: 'allow',
    }
  );

  useHotkey(ek('toggleLeftSidebar'), withCommandPaletteClose(toggleLeftSidebar), {
    conflictBehavior: 'allow',
  });

  useHotkey(ek('toggleRightSidebar'), withCommandPaletteClose(toggleRightSidebar), {
    conflictBehavior: 'allow',
  });

  useHotkey(ek('toggleTheme'), withCommandPaletteClose(toggleTheme), {
    conflictBehavior: 'allow',
  });

  useHotkey(
    ek('toggleKanban'),
    withCommandPaletteClose(() => {}),
    {
      conflictBehavior: 'allow',
    }
  );

  useHotkey(
    ek('toggleEditor'),
    withCommandPaletteClose(() => {}),
    {
      conflictBehavior: 'allow',
    }
  );

  useHotkey(
    ek('nextAgent'),
    withCommandPaletteClose(() =>
      window.dispatchEvent(
        new CustomEvent('emdash:switch-agent', { detail: { direction: 'next' } })
      )
    ),
    { conflictBehavior: 'allow' }
  );

  useHotkey(
    ek('prevAgent'),
    withCommandPaletteClose(() =>
      window.dispatchEvent(
        new CustomEvent('emdash:switch-agent', { detail: { direction: 'prev' } })
      )
    ),
    { conflictBehavior: 'allow' }
  );

  useHotkey(
    ek('openInEditor'),
    withCommandPaletteClose(() => {}),
    {
      conflictBehavior: 'allow',
    }
  );

  return null;
};

export default AppKeyboardShortcuts;
