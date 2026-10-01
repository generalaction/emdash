import type { TerminalShellId } from '@emdash/core/primitives/terminal-shell/api';
import { SettingsCard } from '@emdash/ui/react/patterns';
import { SeparatedList, Select, Switch } from '@emdash/ui/react/primitives';
import React, { useCallback, useMemo } from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import {
  DEFAULT_TERMINAL_SHELL_AVAILABILITY,
  useTerminalShellAvailability,
} from '@core/features/terminals/api/browser/use-terminal-shell-availability';
import { TerminalShellOptionLabel } from '@core/features/terminals/contributions/browser/terminal-shell-option-label';
import { detectPlatformContext } from '@core/primitives/keybindings/api';
import {
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from '@core/primitives/terminals/api';
import { FontFamilySettingRow, FontSizeSettingRow } from './FontSettingsRows';
import { SettingRow } from './SettingRow';

const DEFAULT_FONT_FAMILY = 'Menlo';

const clampFontSize = (size: number) =>
  Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, size));

const isMac = detectPlatformContext().os === 'mac';

const TerminalSettingsCard: React.FC = () => {
  const {
    value: terminal,
    update,
    isLoading: loading,
    isSaving: saving,
  } = useAppSettingsKey('terminal');
  const { data: localShellAvailability = DEFAULT_TERMINAL_SHELL_AVAILABILITY } =
    useTerminalShellAvailability(undefined);

  const fontFamily = terminal?.fontFamily ?? '';
  const fontSize = terminal?.fontSize ?? TERMINAL_FONT_SIZE_DEFAULT;
  const autoCopyOnSelection = terminal?.autoCopyOnSelection ?? false;
  const macOptionIsMeta = terminal?.macOptionIsMeta ?? false;
  const defaultShell = terminal?.defaultShell ?? 'system';
  const selectedShell = useMemo(
    () =>
      localShellAvailability.find((entry) => entry.id === defaultShell) ?? {
        id: defaultShell,
        label: defaultShell === 'system' ? 'Loading...' : defaultShell,
        isSystemDefault: false,
        available: true,
      },
    [defaultShell, localShellAvailability]
  );

  const applyFont = useCallback(
    (next: string) => {
      const normalized = next.trim();
      update({ fontFamily: normalized });
      window.dispatchEvent(
        new CustomEvent('terminal-font-changed', { detail: { fontFamily: normalized } })
      );
    },
    [update]
  );

  const applyFontSize = useCallback(
    (next: number) => {
      const normalized = clampFontSize(next);
      update({ fontSize: normalized });
      window.dispatchEvent(
        new CustomEvent('terminal-font-changed', { detail: { fontSize: normalized } })
      );
    },
    [update]
  );

  const toggleAutoCopy = useCallback(
    (next: boolean) => {
      update({ autoCopyOnSelection: next });
      window.dispatchEvent(
        new CustomEvent('terminal-auto-copy-changed', { detail: { autoCopyOnSelection: next } })
      );
    },
    [update]
  );

  const toggleMacOptionIsMeta = useCallback(
    (next: boolean) => {
      update({ macOptionIsMeta: next });
      window.dispatchEvent(
        new CustomEvent('terminal-mac-option-is-meta-changed', {
          detail: { macOptionIsMeta: next },
        })
      );
    },
    [update]
  );

  const applyDefaultShell = useCallback(
    (next: TerminalShellId) => {
      update({ defaultShell: next });
    },
    [update]
  );

  return (
    <SettingsCard>
      <SeparatedList gap="1rem" direction="column">
        <SettingRow
          title="Default terminal shell"
          description="Used for new local terminals. Remote terminals use the remote system shell."
          control={
            <Select.Root
              value={defaultShell}
              onValueChange={(next) => applyDefaultShell(next as TerminalShellId)}
              disabled={loading || saving}
            >
              <Select.Trigger className="w-[183px] shrink-0 gap-2 [&>span]:line-clamp-none">
                <Select.Value>
                  <TerminalShellOptionLabel entry={selectedShell} showSystemBadge={false} />
                </Select.Value>
              </Select.Trigger>
              <Select.Content align="end" className="min-w-max">
                {localShellAvailability.map((entry) => (
                  <Select.Item
                    key={entry.id}
                    value={entry.id}
                    disabled={!entry.available}
                    title={entry.reason}
                  >
                    <TerminalShellOptionLabel entry={entry} />
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          }
        />
        <FontFamilySettingRow
          title="Terminal font"
          description="Choose the font family for the terminal."
          value={fontFamily}
          defaultLabel={`Default (${DEFAULT_FONT_FAMILY})`}
          defaultPreviewFontFamily={DEFAULT_FONT_FAMILY}
          disabled={loading || saving}
          onChange={applyFont}
        />
        <FontSizeSettingRow
          title="Terminal font size"
          description="Adjust the font size used by terminal sessions and CLI agents."
          value={fontSize}
          min={TERMINAL_FONT_SIZE_MIN}
          max={TERMINAL_FONT_SIZE_MAX}
          controlLabel="terminal font size"
          disabled={loading || saving}
          onChange={applyFontSize}
        />
        <SettingRow
          title="Auto-copy selected text"
          description="Automatically copy text to clipboard when you select it in the terminal."
          control={
            <Switch
              checked={autoCopyOnSelection}
              disabled={loading || saving}
              onCheckedChange={toggleAutoCopy}
            />
          }
        />
        {isMac ? (
          <SettingRow
            title="Use Option as Meta key"
            description="Treat the Option key as the Meta key in the terminal."
            control={
              <Switch
                checked={macOptionIsMeta}
                disabled={loading || saving}
                onCheckedChange={toggleMacOptionIsMeta}
              />
            }
          />
        ) : null}
      </SeparatedList>
    </SettingsCard>
  );
};

export default TerminalSettingsCard;
