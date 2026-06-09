import { Eye, Pencil } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

interface PreviewSourceToggleProps {
  activeMode: 'preview' | 'source';
  onSwitch: (mode: 'preview' | 'source') => void;
  className?: string;
  /** Accessibility label for the Eye (preview) item. */
  previewLabel?: string;
  /** Accessibility label for the Pencil (source) item. */
  sourceLabel?: string;
}

const DEFAULT_CLASSNAME = 'absolute right-3 top-3 z-10';

/**
 * Floating Eye/Pencil toggle for switching between a rendered preview and a
 * Monaco source view. Used by the HTML renderer pair (preview iframe ↔ Monaco)
 * and the markdown diff renderer (rendered preview ↔ source diff).
 */
export function PreviewSourceToggle({
  activeMode,
  onSwitch,
  className = DEFAULT_CLASSNAME,
  previewLabel = 'View rendered',
  sourceLabel = 'Edit source',
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
      <ToggleGroupItem value="preview" aria-label={previewLabel}>
        <Eye className="h-3.5 w-3.5" />
      </ToggleGroupItem>
      <ToggleGroupItem value="source" aria-label={sourceLabel}>
        <Pencil className="h-3.5 w-3.5" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
