import { Toggle, Tooltip } from '@emdash/ui/react/primitives';
import { PanelLeft } from 'lucide-react';
import { NavButtons } from '@core/primitives/ui/browser/components/nav-buttons';
import { BoundShortcut } from '@core/primitives/ui/browser/shortcut';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';

export function SidebarSpace() {
  const { isLeftOpen, setCollapsed } = useWorkspaceLayoutContext();
  return (
    <div className="flex h-10 w-full items-center justify-end gap-2 px-2 [-webkit-app-region:drag]">
      <NavButtons />
      <Tooltip.Root>
        <Tooltip.Trigger>
          <Toggle
            className="size-7 bg-background-tertiary-3 [-webkit-app-region:no-drag] hover:bg-background-tertiary-3 data-pressed:bg-background-tertiary-2"
            size="sm"
            icon
            pressed={isLeftOpen}
            onPressedChange={() => setCollapsed('left', isLeftOpen)}
          >
            <PanelLeft className="h-4 w-4" />
          </Toggle>
        </Tooltip.Trigger>
        <Tooltip.Content>
          Toggle left sidebar
          <BoundShortcut command="workbench.toggleLeftSidebar" variant="keycaps" />
        </Tooltip.Content>
      </Tooltip.Root>
    </div>
  );
}
