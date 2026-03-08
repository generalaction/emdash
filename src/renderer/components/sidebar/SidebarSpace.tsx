import { PanelLeft } from 'lucide-react';
import { useWorkspaceLayoutContext } from '@renderer/contexts/WorkspaceLayoutProvider';
import { Toggle } from '../ui/toggle';

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
