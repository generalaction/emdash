import { ChevronsUpDownIcon } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
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
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

type FontPickerWindow = Window & {
  queryLocalFonts?: () => Promise<Array<{ family: string }>>;
};

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

const DEFAULT_OPTION: FontOption = {
  value: '',
  label: 'Default (Menlo)',
};

const dedupeAndSort = (fonts: string[]) =>
  Array.from(new Set(fonts.map((font) => font.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );

const queryInstalledFonts = async (): Promise<string[]> => {
  const fontWindow = window as FontPickerWindow;
  if (typeof fontWindow.queryLocalFonts === 'function') {
    try {
      const fonts = await fontWindow.queryLocalFonts();
      return dedupeAndSort(fonts.map((f) => f.family));
    } catch {
      // Permission denied or unsupported in this context — fall through to IPC.
    }
  }
  try {
    const result = await rpc.app.listInstalledFonts();
    if (result?.success && Array.isArray(result.fonts)) {
      return dedupeAndSort(result.fonts);
    }
  } catch {
    // Swallow — UI shows just the default option.
  }
  return [];
};

let installedFontsCache: string[] | null = null;
let installedFontsPromise: Promise<string[]> | null = null;

const getInstalledFonts = (): Promise<string[]> => {
  if (installedFontsCache) return Promise.resolve(installedFontsCache);
  if (installedFontsPromise) return installedFontsPromise;
  installedFontsPromise = queryInstalledFonts().then((fonts) => {
    installedFontsCache = fonts;
    installedFontsPromise = null;
    return fonts;
  });
  return installedFontsPromise;
};

const TerminalSettingsCard: React.FC = () => {
  const {
    value: terminal,
    update,
    isLoading: loading,
    isSaving: saving,
  } = useAppSettingsKey('terminal');
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [installedFonts, setInstalledFonts] = useState<string[]>(() => installedFontsCache ?? []);

  useEffect(() => {
    if (installedFontsCache) return;
    let cancelled = false;
    void getInstalledFonts().then((fonts) => {
      if (!cancelled) setInstalledFonts(fonts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const fontFamily = terminal?.fontFamily ?? '';
  const autoCopyOnSelection = terminal?.autoCopyOnSelection ?? false;

  const groups = useMemo<FontGroup[]>(() => {
    const installedSet = new Set(installedFonts.map((f) => f.toLowerCase()));
    const popularSet = new Set(POPULAR_FONTS.map((f) => f.toLowerCase()));

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
                            {item.label}
                          </ComboboxItem>
                        )}
                      </ComboboxCollection>
                    </ComboboxGroup>
                  )}
                </ComboboxList>
                <ComboboxEmpty>No fonts found.</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
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
