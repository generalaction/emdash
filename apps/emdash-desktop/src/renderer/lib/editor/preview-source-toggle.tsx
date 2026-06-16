import { Eye, Pencil } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

interface PreviewSourceToggleProps {
  activeMode: 'preview' | 'source';
  onSwitch: (mode: 'preview' | 'source') => void;
  className?: string;
}

const DEFAULT_CLASSNAME = 'absolute right-3 top-3 z-10';

/**
 * Floating Eye/Pencil toggle for switching between a rendered preview and
 * Monaco source view. Used by the HTML renderer pair (preview iframe ↔ Monaco).
 */
export function PreviewSourceToggle({
  activeMode,
  onSwitch,
  className = DEFAULT_CLASSNAME,
}: PreviewSourceToggleProps) {
  return (
    <ToggleGroup
      value={[activeMode]}
      onValueChange={(value) => {
        const next = value.find((v) => v !== activeMode);
        if (next === 'preview' || next === 'source') onSwitch(next);
      }}
      size="sm"
      className={className}
    >
      <ToggleGroupItem value="preview" aria-label="View rendered">
        <Eye className="h-3.5 w-3.5" />
      </ToggleGroupItem>
      <ToggleGroupItem value="source" aria-label="Edit source">
        <Pencil className="h-3.5 w-3.5" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
