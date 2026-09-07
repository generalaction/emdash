import { Combobox } from '@emdash/ui/react/primitives';
import { ChevronDown, FolderClosed, FolderInput } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import {
  asAvailableProject,
  getProjectManagerStore,
} from '@core/features/projects/api/browser/stores/project-selectors';

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
      const context = asAvailableProject(store);
      return context
        ? [
            {
              value: id,
              label: context.project.name,
              isSsh: context.project.type === 'ssh',
            },
          ]
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
    <Combobox.Root
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
        <Combobox.Trigger className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-transparent px-2.5 py-2 text-sm outline-none hover:bg-background-2 data-popup-open:bg-background-2">
          {selectedOption && <ProjectIcon isSsh={selectedOption.isSsh} />}
          <Combobox.Value placeholder="Select a project" />
          <ChevronDown className="ml-auto size-4 shrink-0 text-foreground-passive" />
        </Combobox.Trigger>
      )}
      <Combobox.Content className="w-auto min-w-(--anchor-width)">
        <Combobox.Input showTrigger={false} placeholder="Search projects..." />
        <Combobox.List className="pb-0">
          {(group: { value: string; items: ProjectOption[] }) => (
            <Combobox.Group key={group.value} items={group.items} className="py-1">
              <Combobox.Collection>
                {(item: ProjectOption) => (
                  <Combobox.Item key={item.value} value={item} className="flex items-center gap-2">
                    <ProjectIcon isSsh={item.isSsh} />
                    {item.label}
                  </Combobox.Item>
                )}
              </Combobox.Collection>
            </Combobox.Group>
          )}
        </Combobox.List>
      </Combobox.Content>
    </Combobox.Root>
  );
});
