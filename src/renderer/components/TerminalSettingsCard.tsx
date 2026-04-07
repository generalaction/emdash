import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { useAppContext } from '@/contexts/AppContextProvider';

type FontOption = {
  id: string;
  label: string;
  fontValue: string;
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

const toOptionId = (font: string) =>
  `font-${font
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}`;

const dedupeAndSort = (fonts: string[]) =>
  Array.from(new Set(fonts.map((font) => font.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );

const TerminalSettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading, isSaving: saving } = useAppSettings();
  const { platform } = useAppContext();
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [installedFonts, setInstalledFonts] = useState<string[] | null>(null);
  const [loadingFonts, setLoadingFonts] = useState<boolean>(false);

  const fontFamily = settings?.terminal?.fontFamily ?? '';
  const fontSize = settings?.terminal?.fontSize ?? 0;
  const autoCopyOnSelection = settings?.terminal?.autoCopyOnSelection ?? false;
  const macOptionIsMeta = settings?.terminal?.macOptionIsMeta ?? false;

  const popularOptions = useMemo<FontOption[]>(() => {
    return [
      { id: 'popular-default', label: 'Default (Menlo)', fontValue: '' },
      ...POPULAR_FONTS.map((font) => ({
        id: `popular-${toOptionId(font)}`,
        label: font,
        fontValue: font,
      })),
    ];
  }, []);

  const installedOptions = useMemo<FontOption[]>(() => {
    const sourceFonts = dedupeAndSort(installedFonts ?? []);
    return sourceFonts
      .filter(
        (font) =>
          !POPULAR_FONTS.some((popular) => popular.toLowerCase() === font.toLowerCase()) &&
          font.toLowerCase() !== 'menlo'
      )
      .map((font) => ({
        id: `installed-${toOptionId(font)}`,
        label: font,
        fontValue: font,
      }));
  }, [installedFonts]);

  const allOptions = useMemo<FontOption[]>(() => {
    const byValue = new Map<string, FontOption>();
    for (const option of [...popularOptions, ...installedOptions]) {
      byValue.set(option.fontValue.toLowerCase(), option);
    }
    return Array.from(byValue.values());
  }, [installedOptions, popularOptions]);

  const findPreset = useCallback(
    (font: string) => {
      const normalized = font.trim().toLowerCase();
      return allOptions.find((option) => option.fontValue.toLowerCase() === normalized) ?? null;
    },
    [allOptions]
  );

  const loadInstalledFonts = useCallback(async () => {
    if (loadingFonts || installedFonts !== null) return;
    setLoadingFonts(true);
    try {
      const result = await window.electronAPI.listInstalledFonts();
      if (result?.success && Array.isArray(result.fonts) && result.fonts.length) {
        setInstalledFonts(dedupeAndSort(result.fonts));
      } else {
        setInstalledFonts([]);
      }
    } catch {
      setInstalledFonts([]);
    } finally {
      setLoadingFonts(false);
    }
  }, [installedFonts, loadingFonts]);

  useEffect(() => {
    if (pickerOpen) {
      void loadInstalledFonts();
    }
  }, [loadInstalledFonts, pickerOpen]);

  const applyFont = useCallback(
    (next: string) => {
      const normalized = next.trim();
      updateSettings({ terminal: { fontFamily: normalized } });
      window.dispatchEvent(
        new CustomEvent('terminal-font-changed', { detail: { fontFamily: normalized } })
      );
    },
    [updateSettings]
  );

  const applyFontSize = useCallback(
    (next: number) => {
      updateSettings({ terminal: { fontSize: next } });
      window.dispatchEvent(
        new CustomEvent('terminal-font-size-changed', { detail: { fontSize: next } })
      );
    },
    [updateSettings]
  );

  const toggleAutoCopy = useCallback(
    (next: boolean) => {
      updateSettings({ terminal: { autoCopyOnSelection: next } });
      window.dispatchEvent(
        new CustomEvent('terminal-auto-copy-changed', { detail: { autoCopyOnSelection: next } })
      );
    },
    [updateSettings]
  );

  const toggleMacOptionIsMeta = useCallback(
    (next: boolean) => {
      updateSettings({ terminal: { macOptionIsMeta: next } });
      window.dispatchEvent(
        new CustomEvent('terminal-mac-option-is-meta-changed', {
          detail: { macOptionIsMeta: next },
        })
      );
    },
    [updateSettings]
  );

  const selectedPreset = findPreset(fontFamily);
  const pickerLabel = fontFamily.trim()
    ? (selectedPreset?.label ?? `Custom: ${fontFamily.trim()}`)
    : 'Default (Menlo)';

  const filteredPopularOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return popularOptions;
    return popularOptions.filter((option) => option.label.toLowerCase().includes(query));
  }, [popularOptions, search]);

  const filteredInstalledOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return installedOptions;
    return installedOptions.filter((option) => option.label.toLowerCase().includes(query));
  }, [installedOptions, search]);

  const hasAnyResults = filteredPopularOptions.length > 0 || filteredInstalledOptions.length > 0;

  return (
    <div id="terminal-settings-card" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">Terminal font</p>
          <p className="text-sm text-muted-foreground">Choose the font family for the terminal.</p>
        </div>
        <div className="w-[183px] flex-shrink-0">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-9 w-full justify-between text-sm font-normal"
                disabled={loading || saving}
              >
                <span className="truncate text-left">{pickerLabel}</span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-70" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
              <div className="grid gap-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const typed = search.trim();
                    if (!typed) return;
                    setSearch('');
                    setPickerOpen(false);
                    applyFont(typed);
                  }}
                  placeholder="Search or type custom font"
                  aria-label="Search font options"
                  className="h-8"
                />
                <div className="max-h-56 overflow-auto">
                  {filteredPopularOptions.length > 0 ? (
                    <>
                      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Popular
                      </div>
                      {filteredPopularOptions.map((option) => {
                        const selected =
                          selectedPreset?.fontValue.toLowerCase() ===
                          option.fontValue.toLowerCase();
                        return (
                          <button
                            key={option.id}
                            type="button"
                            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                            onClick={() => {
                              setSearch('');
                              setPickerOpen(false);
                              applyFont(option.fontValue);
                            }}
                          >
                            <span>{option.label}</span>
                            {selected ? <Check className="h-4 w-4 opacity-80" /> : null}
                          </button>
                        );
                      })}
                    </>
                  ) : null}

                  {filteredInstalledOptions.length > 0 || loadingFonts ? (
                    <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Installed Fonts
                    </div>
                  ) : null}

                  {loadingFonts ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Loading installed fonts...
                    </div>
                  ) : null}

                  {filteredInstalledOptions.map((option) => {
                    const selected =
                      selectedPreset?.fontValue.toLowerCase() === option.fontValue.toLowerCase();
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          setSearch('');
                          setPickerOpen(false);
                          applyFont(option.fontValue);
                        }}
                      >
                        <span>{option.label}</span>
                        {selected ? <Check className="h-4 w-4 opacity-80" /> : null}
                      </button>
                    );
                  })}

                  {!loadingFonts && !hasAnyResults ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">No fonts found.</div>
                  ) : null}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">Terminal font size</p>
          <p className="text-sm text-muted-foreground">
            Font size in pixels. Default uses your terminal config or 13px.
          </p>
        </div>
        <div className="w-[120px] flex-shrink-0">
          <Select
            value={fontSize === 0 ? 'default' : String(fontSize)}
            onValueChange={(v) => applyFontSize(v === 'default' ? 0 : parseInt(v, 10))}
            disabled={loading || saving}
          >
            <SelectTrigger className="h-9 bg-background hover:bg-accent hover:text-accent-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="10">10px</SelectItem>
              <SelectItem value="11">11px</SelectItem>
              <SelectItem value="12">12px</SelectItem>
              <SelectItem value="13">13px</SelectItem>
              <SelectItem value="14">14px</SelectItem>
              <SelectItem value="16">16px</SelectItem>
              <SelectItem value="18">18px</SelectItem>
              <SelectItem value="20">20px</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">Auto-copy selected text</p>
          <p className="text-sm text-muted-foreground">
            Automatically copy text to clipboard when you select it in the terminal.
          </p>
        </div>
        <Switch
          aria-label="Auto-copy selected text"
          checked={autoCopyOnSelection}
          disabled={loading || saving}
          onCheckedChange={toggleAutoCopy}
        />
      </div>
      {platform === 'darwin' ? (
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Use Option as Meta key</p>
            <p className="text-sm text-muted-foreground">
              Treat the Option key as the Meta key in the terminal.
            </p>
          </div>
          <Switch
            aria-label="Use Option as Meta key"
            checked={macOptionIsMeta}
            disabled={loading || saving}
            onCheckedChange={toggleMacOptionIsMeta}
          />
        </div>
      ) : null}
    </div>
  );
};

export default TerminalSettingsCard;
