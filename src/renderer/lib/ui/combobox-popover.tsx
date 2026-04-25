import { ReactNode, useState } from 'react';
import { cn } from '@renderer/utils/utils';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from './combobox';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ComboboxSelectOption {
  value: string;
  label: string;
}

export interface ComboboxAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

export interface ComboboxPopoverProps<T extends ComboboxSelectOption> {
  /** The trigger element — should be a ComboboxTrigger */
  trigger: ReactNode;
  items: T[];
  actions?: ComboboxAction[];
  value?: T | null;
  defaultValue?: T;
  onValueChange?: (item: T) => void;
  placeholder?: string;
  contentClassName?: string;
}

// ─── Internals ────────────────────────────────────────────────────────────────

// Action items get a `value` field (required by ComboboxItem) and a `_type`
// discriminator so the filter and onValueChange can tell them apart from options.
type ActionItem = ComboboxAction & { value: string; _type: 'action' };

// Matches Base UI's Group<Item> = { value: unknown; items: Item[] }
type OptionsGroup<T> = { value: 'options'; items: T[] };
type ActionsGroup = { value: 'actions'; items: ActionItem[] };
type ItemGroup<T> = OptionsGroup<T> | ActionsGroup;

function buildGroups<T extends ComboboxSelectOption>(
  items: T[],
  actions: ComboboxAction[]
): ItemGroup<T>[] {
  const groups: ItemGroup<T>[] = [{ value: 'options', items }];
  if (actions.length > 0) {
    groups.push({
      value: 'actions',
      items: actions.map((a) => ({
        ...a,
        value: `__action__:${a.id}`,
        _type: 'action' as const,
      })),
    });
  }
  return groups;
}

// Using `unknown` input so this can safely narrow any runtime value,
// including items typed as T that are actually ActionItems at runtime.
function isActionItem(item: unknown): item is ActionItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    '_type' in item &&
    (item as ActionItem)._type === 'action'
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ComboboxPopover<T extends ComboboxSelectOption>({
  trigger,
  items,
  actions = [],
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Search...',
  contentClassName,
}: ComboboxPopoverProps<T>) {
  const groups = buildGroups(items, actions);

  const [internalItem, setInternalItem] = useState<T | null>(() => defaultValue ?? null);
  const [open, setOpen] = useState(false);

  const isControlled = value !== undefined;
  const selectedItem = isControlled ? (value ?? null) : internalItem;

  function handleValueChange(item: T | null) {
    if (!item) return;
    if (isActionItem(item)) {
      item.onClick();
      setOpen(false);
    } else {
      if (!isControlled) setInternalItem(item);
      onValueChange?.(item);
    }
  }

  return (
    <Combobox
      items={groups}
      value={selectedItem}
      onValueChange={handleValueChange}
      open={open}
      onOpenChange={setOpen}
      isItemEqualToValue={(a: T, b: T) => a.value === b.value}
      filter={(item: T, query) =>
        isActionItem(item) || item.label.toLowerCase().includes(query.toLowerCase())
      }
      autoHighlight
    >
      {trigger}
      <ComboboxContent className={cn('min-w-(--anchor-width)', contentClassName)}>
        <ComboboxInput showTrigger={false} placeholder={placeholder} />
        <ComboboxList className={'pb-0'}>
          {(group: ItemGroup<T>) => (
            <ComboboxGroup
              key={group.value as string}
              items={group.items}
              className={
                group.value === 'actions'
                  ? 'sticky bottom-0 -mx-1 px-1 border-t border-border bg-popover pt-1 pb-1 rounded-b-md'
                  : 'py-1'
              }
            >
              <ComboboxCollection>
                {(item: T | ActionItem) =>
                  isActionItem(item) ? (
                    <ComboboxItem key={item.id} value={item as unknown as T}>
                      {item.icon}
                      {item.label}
                    </ComboboxItem>
                  ) : (
                    <ComboboxItem key={(item as T).value} value={item as T}>
                      {(item as T).label}
                    </ComboboxItem>
                  )
                }
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
