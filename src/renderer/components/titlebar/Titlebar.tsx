import { useWorkspaceLayoutContext } from '@/contexts/WorkspaceLayoutProvider';
import { Toggle } from '@/components/ui/toggle';
import { PanelLeft, PanelRight } from 'lucide-react';

export function Titlebar({ children }: { children: React.ReactNode }) {
  const { isLeftOpen, isRightOpen, setCollapsed } = useWorkspaceLayoutContext();
  return (
    <header className="fixed inset-x-0 top-0 z-[80] flex h-[var(--tb,36px)] items-center justify-end bg-muted pr-2 shadow-[inset_0_-1px_0_hsl(var(--border))] [-webkit-app-region:drag] dark:bg-background">
      <div className="pointer-events-auto flex items-center gap-1 [-webkit-app-region:no-drag]">
        {children}
        <Toggle pressed={isLeftOpen} onPressedChange={() => setCollapsed('left', isLeftOpen)}>
          <PanelLeft className="h-4 w-4" />
        </Toggle>
        <Toggle pressed={isRightOpen} onPressedChange={() => setCollapsed('right', isRightOpen)}>
          <PanelRight className="h-4 w-4" />
        </Toggle>
      </div>
    </header>
  );
}
