import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDownIcon, LoaderCircle, Minus, Plus } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useInstalledFonts } from '@renderer/features/settings/use-installed-fonts';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@renderer/lib/ui/combobox';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import {
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_SHELL_IDS,
  type TerminalShellAvailability,
  type TerminalShellId,
} from '@shared/terminal-settings';
import { SettingRow } from './SettingRow';

type FontOption = {
  value: string;
  label: string;
};

type FontGroup = {
  value: 'popular' | 'installed';
  label: string;
  items: FontOption[];
};

const POPULAR_FONTS = [
  'Menlo',
  'SF Mono',
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Iosevka',
  'Source Code Pro',
  'MesloLGS NF',
];

const DEFAULT_FONT_FAMILY = 'Menlo';

const shellAvailabilityQueryKey = ['terminal-shell-availability'] as const;

const DEFAULT_OPTION: FontOption = {
  value: '',
  label: `Default (${DEFAULT_FONT_FAMILY})`,
};

const clampFontSize = (size: number) =>
  Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, size));

function shellLabel(shell: TerminalShellId): string {
  return shell === 'auto' ? 'Auto (Default)' : shell;
}

const TerminalSettingsCard: React.FC = () => {
  const {
    value: terminal,
    update,
    isLoading: loading,
    isSaving: saving,
  } = useAppSettingsKey('terminal');
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const { fonts: installedFonts, isLoading: loadingFonts } = useInstalledFonts();
  const { data: shellAvailability } = useQuery<TerminalShellAvailability[]>({
    queryKey: shellAvailabilityQueryKey,
    queryFn: () => rpc.appSettings.getTerminalShellAvailability(),
    staleTime: 60_000,
  });

  const fontFamily = terminal?.fontFamily ?? '';
  const fontSize = terminal?.fontSize ?? TERMINAL_FONT_SIZE_DEFAULT;
  const shell = terminal?.shell ?? 'auto';
  const autoCopyOnSelection = terminal?.autoCopyOnSelection ?? false;
  const shellAvailabilityById = useMemo(() => {
    return new Map((shellAvailability ?? []).map((item) => [item.shell, item]));
  }, [shellAvailability]);
  const selectedShellAvailability = shellAvailabilityById.get(shell);

  const groups = useMemo<FontGroup[]>(() => {
    const popularSet = new Set(POPULAR_FONTS.map((f) => f.toLowerCase()));

    const installedSet = new Set(installedFonts.map((font) => font.toLowerCase()));
    const popularItems: FontOption[] = [DEFAULT_OPTION];
    for (const font of POPULAR_FONTS) {
      if (installedSet.has(font.toLowerCase())) {
        popularItems.push({ value: font, label: font });
      }
    }

    const installedItems: FontOption[] = [];
    for (const font of installedFonts) {
      const lower = font.toLowerCase();
      if (popularSet.has(lower)) continue;
      installedItems.push({ value: font, label: font });
    }

    return [
      { value: 'popular', label: 'Popular', items: popularItems },
      { value: 'installed', label: 'Installed', items: installedItems },
    ];
  }, [installedFonts]);

  const visibleGroups = useMemo<FontGroup[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups.filter((group) => group.items.length > 0);
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.label.toLowerCase().includes(q)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  const selectedOption = useMemo<FontOption | null>(() => {
    if (!fontFamily) return DEFAULT_OPTION;
    for (const group of groups) {
      const match = group.items.find((o) => o.value.toLowerCase() === fontFamily.toLowerCase());
      if (match) return match;
    }
    return { value: fontFamily, label: fontFamily };
  }, [fontFamily, groups]);

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

  const applyShell = useCallback(
    (next: TerminalShellId) => {
      update({ shell: next });
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

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title="Terminal shell"
        description={
          selectedShellAvailability && !selectedShellAvailability.available && shell !== 'auto'
            ? `${shellLabel(shell)} was not found locally. Auto is recommended unless this is available on your target host.`
            : 'Choose the shell used for your terminal. Available compatible shells are also used for agent tool calls.'
        }
        control={
          <Select
            value={shell}
            onValueChange={(next) => {
              if (next) applyShell(next);
            }}
          >
            <SelectTrigger
              className="h-9 w-[183px] flex-shrink-0 justify-between"
              disabled={loading || saving}
              aria-label="Select terminal shell"
            >
              <span className="truncate">{shellLabel(shell)}</span>
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false} sideOffset={6}>
              {TERMINAL_SHELL_IDS.map((shellId) => {
                const availability = shellAvailabilityById.get(shellId);
                const unavailable = availability?.available === false;
                return (
                  <SelectItem key={shellId} value={shellId}>
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-4">
                      <span>{shellLabel(shellId)}</span>
                      {unavailable && shellId !== 'auto' ? (
                        <span className="text-xs text-foreground-passive">Not found locally</span>
                      ) : null}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        }
      />
      <SettingRow
        title="Terminal font"
        description="Choose the font family for the terminal."
        control={
          <div className="w-[183px] flex-shrink-0">
            <Combobox
              items={visibleGroups}
              value={selectedOption}
              onValueChange={(opt: FontOption | null) => {
                if (opt) applyFont(opt.value);
              }}
              open={pickerOpen}
              onOpenChange={(open) => {
                setPickerOpen(open);
                if (!open) setQuery('');
              }}
              inputValue={query}
              onInputValueChange={(val: string, { reason }: { reason: string }) => {
                if (reason !== 'item-press') setQuery(val);
              }}
              isItemEqualToValue={(a: FontOption, b: FontOption) => a.value === b.value}
              filter={null}
              autoHighlight
            >
              <ComboboxTrigger
                render={
                  <button
                    type="button"
                    disabled={loading || saving}
                    className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-transparent px-2.5 py-1 text-left text-sm font-normal outline-none disabled:opacity-50"
                  >
                    <ComboboxValue placeholder="Default (Menlo)" />
                    <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 text-foreground-muted" />
                  </button>
                }
              />
              <ComboboxContent>
                <ComboboxInput
                  showTrigger={false}
                  placeholder="Search or type custom font"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const typed = e.currentTarget.value.trim();
                    if (!typed) return;
                    e.preventDefault();
                    applyFont(typed);
                    setPickerOpen(false);
                  }}
                />
                <ComboboxList>
                  {(group: FontGroup) => (
                    <ComboboxGroup key={group.value} items={group.items}>
                      <ComboboxLabel>{group.label}</ComboboxLabel>
                      <ComboboxCollection>
                        {(item: FontOption) => (
                          <ComboboxItem key={item.value || '__default__'} value={item}>
                            <span
                              style={{
                                fontFamily: item.value ? `"${item.value}"` : DEFAULT_FONT_FAMILY,
                              }}
                            >
                              {item.label}
                            </span>
                          </ComboboxItem>
                        )}
                      </ComboboxCollection>
                    </ComboboxGroup>
                  )}
                </ComboboxList>
                {loadingFonts ? (
                  <div className="px-1 pb-1">
                    <div className="px-2 py-1.5 text-xs text-foreground-muted">Installed</div>
                    <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground-muted">
                      <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
                      <span className="truncate">Loading fonts...</span>
                    </div>
                  </div>
                ) : null}
                <ComboboxEmpty>No fonts found.</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
          </div>
        }
      />
      <SettingRow
        title="Terminal font size"
        description="Adjust the font size used by terminal sessions and CLI agents."
        control={
          <div className="flex h-9 w-[183px] flex-shrink-0 items-center justify-between rounded-md border border-border bg-background px-1 shadow-xs">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={loading || saving || fontSize <= TERMINAL_FONT_SIZE_MIN}
              onClick={() => applyFontSize(fontSize - 1)}
              aria-label="Decrease terminal font size"
            >
              <Minus />
            </Button>
            <div className="flex min-w-14 items-baseline justify-center gap-1 text-sm text-foreground tabular-nums">
              <span>{fontSize}</span>
              <span className="text-muted-foreground text-xs">px</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={loading || saving || fontSize >= TERMINAL_FONT_SIZE_MAX}
              onClick={() => applyFontSize(fontSize + 1)}
              aria-label="Increase terminal font size"
            >
              <Plus />
            </Button>
          </div>
        }
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
    </div>
  );
};

export default TerminalSettingsCard;
