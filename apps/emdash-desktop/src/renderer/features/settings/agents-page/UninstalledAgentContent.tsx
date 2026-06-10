import { Button } from '@renderer/lib/ui/button';
import { SheetFooter } from '@renderer/lib/ui/sheet';

export interface UninstalledAgentContentProps {
  onClose: () => void;
}

export function UninstalledAgentContent({ onClose }: UninstalledAgentContentProps) {
  return (
    <SheetFooter>
      <Button type="button" variant="outline" size="sm" onClick={onClose} className="ml-auto">
        Close
      </Button>
    </SheetFooter>
  );
}
