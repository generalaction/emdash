import { X } from 'lucide-react';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';

export function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex flex-row items-center justify-between gap-1.5 p-4">
      <MicroLabel>{title}</MicroLabel>
      <Button variant="ghost" size="sm" onClick={onClose} className="p-0">
        <X className="size-4" />
      </Button>
    </div>
  );
}
