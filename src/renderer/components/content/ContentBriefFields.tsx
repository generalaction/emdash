import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface ContentBrief {
  topic?: string;
  audience?: string;
  keywords?: string;
  tone?: string;
  notes?: string;
}

interface ContentBriefFieldsProps {
  value: ContentBrief;
  onChange: (brief: ContentBrief) => void;
  disabled?: boolean;
}

export function ContentBriefFields({ value, onChange, disabled = false }: ContentBriefFieldsProps) {
  const handleChange = (field: keyof ContentBrief, fieldValue: string) => {
    onChange({ ...value, [field]: fieldValue });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="content-topic" className="text-xs">
          Topic / Product
        </Label>
        <Input
          id="content-topic"
          placeholder="What is this content about?"
          value={value.topic || ''}
          onChange={(e) => handleChange('topic', e.target.value)}
          disabled={disabled}
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="content-audience" className="text-xs">
          Target Audience
        </Label>
        <Input
          id="content-audience"
          placeholder="Who is this content for?"
          value={value.audience || ''}
          onChange={(e) => handleChange('audience', e.target.value)}
          disabled={disabled}
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="content-keywords" className="text-xs">
          Keywords
        </Label>
        <Input
          id="content-keywords"
          placeholder="SEO keywords (comma-separated)"
          value={value.keywords || ''}
          onChange={(e) => handleChange('keywords', e.target.value)}
          disabled={disabled}
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="content-tone" className="text-xs">
          Tone / Style
        </Label>
        <Input
          id="content-tone"
          placeholder="e.g., Professional, Casual, Friendly"
          value={value.tone || ''}
          onChange={(e) => handleChange('tone', e.target.value)}
          disabled={disabled}
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="content-notes" className="text-xs">
          Additional Notes
        </Label>
        <Textarea
          id="content-notes"
          placeholder="Any other requirements or context..."
          value={value.notes || ''}
          onChange={(e) => handleChange('notes', e.target.value)}
          disabled={disabled}
          rows={2}
          className="text-sm"
        />
      </div>
    </div>
  );
}

/**
 * Check if a content brief has any meaningful data.
 */
export function hasContentBrief(brief: ContentBrief | undefined | null): boolean {
  if (!brief) return false;
  return !!(brief.topic || brief.audience || brief.keywords || brief.tone || brief.notes);
}

/**
 * Format content brief for display (short summary).
 */
export function formatBriefSummary(brief: ContentBrief | undefined | null): string {
  if (!brief) return '';
  const parts: string[] = [];
  if (brief.topic) parts.push(brief.topic);
  if (brief.audience) parts.push(`for ${brief.audience}`);
  return parts.join(' ') || '';
}

/**
 * Format content brief for agent context injection.
 */
export function formatBriefForAgent(brief: ContentBrief | undefined | null): string {
  if (!brief) return '';

  const lines: string[] = ['## Content Brief', ''];

  if (brief.topic) {
    lines.push(`**Topic/Product:** ${brief.topic}`);
  }
  if (brief.audience) {
    lines.push(`**Target Audience:** ${brief.audience}`);
  }
  if (brief.keywords) {
    lines.push(`**Keywords:** ${brief.keywords}`);
  }
  if (brief.tone) {
    lines.push(`**Tone/Style:** ${brief.tone}`);
  }
  if (brief.notes) {
    lines.push('', '**Additional Notes:**', brief.notes);
  }

  return lines.join('\n');
}

export default ContentBriefFields;
