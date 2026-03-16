import { PanelLeft } from 'lucide-react';
import { useWorkspaceLayoutContext } from '@renderer/core/view/layout-provider';
import { Toggle } from '../ui/toggle';

export function SidebarSpace() {
  const { isLeftOpen, setCollapsed } = useWorkspaceLayoutContext();
  return (
    <div className="[-webkit-app-region:drag] flex h-9 w-full justify-end bg-accent">
      <Toggle
        className="[-webkit-app-region:no-drag]"
        pressed={isLeftOpen}
        onPressedChange={() => setCollapsed('left', isLeftOpen)}
      >
        <PanelLeft className="h-4 w-4" />
      </Toggle>
    </div>
  );
}
