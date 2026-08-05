import { ChevronsUpDownIcon, LoaderCircle, Minus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useInstalledFonts } from '@renderer/features/settings/use-installed-fonts';
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

interface FontFamilySettingRowProps {
  title: string;
  description: string;
  value: string;
  defaultLabel: string;
  defaultPreviewFontFamily?: string;
  disabled?: boolean;
  onChange: (fontFamily: string) => void;
}

export function FontFamilySettingRow({
  title,
  description,
  value,
  defaultLabel,
  defaultPreviewFontFamily,
  disabled = false,
  onChange,
}: FontFamilySettingRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { fonts: installedFonts, isLoading: loadingFonts } = useInstalledFonts();

  const defaultOption = useMemo<FontOption>(
    () => ({ value: '', label: defaultLabel }),
    [defaultLabel]
  );

  const groups = useMemo<FontGroup[]>(() => {
    const popularSet = new Set(POPULAR_FONTS.map((font) => font.toLowerCase()));
    const installedSet = new Set(installedFonts.map((font) => font.toLowerCase()));
    const popularItems: FontOption[] = [defaultOption];

    for (const font of POPULAR_FONTS) {
      if (installedSet.has(font.toLowerCase())) {
        popularItems.push({ value: font, label: font });
      }
    }

    const installedItems: FontOption[] = [];
    for (const font of installedFonts) {
      if (popularSet.has(font.toLowerCase())) continue;
      installedItems.push({ value: font, label: font });
    }

    return [
      { value: 'popular', label: 'Popular', items: popularItems },
      { value: 'installed', label: 'Installed', items: installedItems },
    ];
  }, [defaultOption, installedFonts]);

  const visibleGroups = useMemo<FontGroup[]>(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return groups.filter((group) => group.items.length > 0);

    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.label.toLowerCase().includes(normalizedQuery)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  const selectedOption = useMemo<FontOption>(() => {
    if (!value) return defaultOption;

    for (const group of groups) {
      const match = group.items.find(
        (option) => option.value.toLowerCase() === value.toLowerCase()
      );
      if (match) return match;
    }

    return { value, label: value };
  }, [defaultOption, groups, value]);

  return (
    <SettingRow
      title={title}
      description={description}
      control={
        <div className="w-[183px] flex-shrink-0">
          <Combobox
            items={visibleGroups}
            value={selectedOption}
            onValueChange={(option: FontOption | null) => {
              if (option) onChange(option.value);
            }}
            open={pickerOpen}
            onOpenChange={(open) => {
              setPickerOpen(open);
              if (!open) setQuery('');
            }}
            inputValue={query}
            onInputValueChange={(next: string, { reason }: { reason: string }) => {
              if (reason !== 'item-press') setQuery(next);
            }}
            isItemEqualToValue={(a: FontOption, b: FontOption) => a.value === b.value}
            filter={null}
            autoHighlight
          >
            <ComboboxTrigger
              render={
                <button
                  type="button"
                  disabled={disabled}
                  className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-transparent px-2.5 py-1 text-left text-sm font-normal outline-none disabled:opacity-50"
                >
                  <ComboboxValue placeholder={defaultLabel} />
                  <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 text-foreground-muted" />
                </button>
              }
            />
            <ComboboxContent>
              <ComboboxInput
                showTrigger={false}
                placeholder="Search or type custom font"
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  const typed = event.currentTarget.value.trim();
                  if (!typed) return;
                  event.preventDefault();
                  onChange(typed);
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
                              fontFamily: item.value ? `"${item.value}"` : defaultPreviewFontFamily,
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
  );
}

interface FontSizeSettingRowProps {
  title: string;
  description: string;
  value: number;
  min: number;
  max: number;
  controlLabel: string;
  disabled?: boolean;
  onChange: (fontSize: number) => void;
}

export function FontSizeSettingRow({
  title,
  description,
  value,
  min,
  max,
  controlLabel,
  disabled = false,
  onChange,
}: FontSizeSettingRowProps) {
  const applyValue = (next: number) => onChange(Math.min(max, Math.max(min, next)));

  return (
    <SettingRow
      title={title}
      description={description}
      control={
        <div className="flex h-9 w-[183px] flex-shrink-0 items-center justify-between rounded-md border border-border bg-background px-1 shadow-xs">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled || value <= min}
            onClick={() => applyValue(value - 1)}
            aria-label={`Decrease ${controlLabel}`}
          >
            <Minus />
          </Button>
          <div className="flex min-w-14 items-baseline justify-center gap-1 text-sm text-foreground tabular-nums">
            <span>{value}</span>
            <span className="text-muted-foreground text-xs">px</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled || value >= max}
            onClick={() => applyValue(value + 1)}
            aria-label={`Increase ${controlLabel}`}
          >
            <Plus />
          </Button>
        </div>
      }
    />
  );
}
