import { PanelLeft } from 'lucide-react';
import { Toggle } from '../ui/toggle';
import { useWorkspaceLayoutContext } from '@renderer/contexts/WorkspaceLayoutProvider';

export function SidebarSpace() {
  const { isLeftOpen, setCollapsed } = useWorkspaceLayoutContext();
  return (
    <div className="flex h-9 w-full justify-end">
      <Toggle pressed={isLeftOpen} onPressedChange={() => setCollapsed('left', isLeftOpen)}>
        <PanelLeft className="h-4 w-4" />
      </Toggle>
    </div>
  );
}
