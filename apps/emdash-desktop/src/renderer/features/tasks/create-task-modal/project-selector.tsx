import { ChevronDown, FolderClosed, FolderInput } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@renderer/lib/ui/combobox';

interface ProjectOption {
  value: string;
  label: string;
  isSsh: boolean;
}

function ProjectIcon({ isSsh }: { isSsh: boolean }) {
  const Icon = isSsh ? FolderInput : FolderClosed;
  return <Icon className="text-muted-foreground h-4 w-4 shrink-0" />;
}

interface ProjectSelectorProps {
  value: string | undefined;
  onChange: (projectId: string) => void;
  trigger?: React.ReactNode;
}

export const ProjectSelector = observer(function ProjectSelector({
  value,
  onChange,
  trigger,
}: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);

  const options: ProjectOption[] = Array.from(getProjectManagerStore().projects.entries()).flatMap(
    ([id, store]) => {
      const mounted = asMounted(store);
      return mounted
        ? [{ value: id, label: mounted.data.name, isSsh: mounted.data.type === 'ssh' }]
        : [];
    }
  );

  const selectedOption = options.find((o) => o.value === value) ?? null;

  function handleValueChange(item: ProjectOption | null) {
    if (!item) return;
    onChange(item.value);
    setOpen(false);
  }

  return (
    <Combobox
      items={[{ value: 'options', items: options }]}
      value={selectedOption}
      onValueChange={handleValueChange}
      open={open}
      onOpenChange={setOpen}
      isItemEqualToValue={(a: ProjectOption, b: ProjectOption) => a.value === b.value}
      filter={(item: ProjectOption, query) =>
        item.label.toLowerCase().includes(query.toLowerCase())
      }
      autoHighlight
    >
      {trigger ?? (
        <ComboboxTrigger className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-transparent px-2.5 py-2 text-sm outline-none hover:bg-background-2 data-popup-open:bg-background-2">
          {selectedOption && <ProjectIcon isSsh={selectedOption.isSsh} />}
          <ComboboxValue placeholder="Select a project" />
          <ChevronDown className="ml-auto size-4 shrink-0 text-foreground-passive" />
        </ComboboxTrigger>
      )}
      <ComboboxContent className="w-auto min-w-(--anchor-width)">
        <ComboboxInput showTrigger={false} placeholder="Search projects..." />
        <ComboboxList className="pb-0">
          {(group: { value: string; items: ProjectOption[] }) => (
            <ComboboxGroup key={group.value} items={group.items} className="py-1">
              <ComboboxCollection>
                {(item: ProjectOption) => (
                  <ComboboxItem key={item.value} value={item} className="flex items-center gap-2">
                    <ProjectIcon isSsh={item.isSsh} />
                    {item.label}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
});
