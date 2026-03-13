import { Tabs } from '@base-ui/react';
import { Folder, Github, Plus } from 'lucide-react';
import { type Mode } from './add-project-modal';
import { ButtonCard } from './button-card';

export function ModeTabs({
  mode,
  onModeChange,
  children,
}: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  children: React.ReactNode;
}) {
  return (
    <Tabs.Root
      value={mode}
      onValueChange={(v) => onModeChange(v as Mode)}
      className="flex flex-col gap-6"
    >
      <Tabs.List className="w-full flex gap-2">
        <Tabs.Tab
          value="pick"
          render={
            <ButtonCard>
              <Folder className="size-6" />
              Pick existing
            </ButtonCard>
          }
        />
        <Tabs.Tab
          value="new"
          render={
            <ButtonCard>
              <Plus className="size-6" />
              New
            </ButtonCard>
          }
        />
        <Tabs.Tab
          value="clone"
          render={
            <ButtonCard>
              <Github className="size-6" />
              Clone
            </ButtonCard>
          }
        />
      </Tabs.List>
      <div>{children}</div>
    </Tabs.Root>
  );
}
