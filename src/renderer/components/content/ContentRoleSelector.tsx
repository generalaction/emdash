import { Label } from '@/components/ui/label';
import { CONTENT_ROLES, PROMPT_TEMPLATES, type ContentRole } from '@shared/content/promptTemplates';
import { cn } from '@/lib/utils';
import { Search, Target, PenTool, MessageSquare, Edit3 } from 'lucide-react';

interface ContentRoleSelectorProps {
  selectedRole: ContentRole | null;
  onRoleChange: (role: ContentRole | null) => void;
  disabled?: boolean;
  className?: string;
}

const ROLE_ICONS: Record<ContentRole, React.ReactNode> = {
  researcher: <Search className="h-4 w-4" />,
  'seo-specialist': <Target className="h-4 w-4" />,
  copywriter: <PenTool className="h-4 w-4" />,
  'brand-voice': <MessageSquare className="h-4 w-4" />,
  editor: <Edit3 className="h-4 w-4" />,
};

export function ContentRoleSelector({
  selectedRole,
  onRoleChange,
  disabled = false,
  className,
}: ContentRoleSelectorProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label className="text-xs">Content Role (optional)</Label>
      <div className="flex flex-wrap gap-2">
        {CONTENT_ROLES.map((roleId) => {
          const template = PROMPT_TEMPLATES[roleId];
          const isSelected = selectedRole === roleId;

          return (
            <button
              key={roleId}
              type="button"
              disabled={disabled}
              onClick={() => onRoleChange(isSelected ? null : roleId)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                isSelected
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-50'
              )}
              title={template.description}
            >
              {ROLE_ICONS[roleId]}
              {template.name}
            </button>
          );
        })}
      </div>
      {selectedRole && (
        <p className="text-xs text-muted-foreground">
          {PROMPT_TEMPLATES[selectedRole].description}
        </p>
      )}
    </div>
  );
}

export default ContentRoleSelector;
