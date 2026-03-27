import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { MountedProject } from '@renderer/core/stores/project';
import { projectManagerStore } from '@renderer/core/stores/project-manager';
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
} from './ui/combobox';

interface ProjectOption {
  value: string;
  label: string;
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

  const options: ProjectOption[] = Array.from(projectManagerStore.projects.entries())
    .filter(([, store]) => store.state === 'mounted')
    .map(([id, store]) => ({
      value: id,
      label: (store as MountedProject).data.name,
    }));

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
        <ComboboxTrigger className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none">
          <ComboboxValue placeholder="Select a project" />
        </ComboboxTrigger>
      )}
      <ComboboxContent className="w-auto min-w-(--anchor-width)">
        <ComboboxInput showTrigger={false} placeholder="Search projects..." />
        <ComboboxList className="pb-0">
          {(group: { value: string; items: ProjectOption[] }) => (
            <ComboboxGroup key={group.value} items={group.items} className="py-1">
              <ComboboxCollection>
                {(item: ProjectOption) => (
                  <ComboboxItem key={item.value} value={item}>
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
