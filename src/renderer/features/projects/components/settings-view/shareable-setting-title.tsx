import { RotateCcw } from 'lucide-react';
import type {
  ProjectSettingsOverrideState,
  ShareableProjectSettingsWriteField,
} from '@shared/project-settings';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { FieldTitle } from '@renderer/lib/ui/field';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

type Props = {
  children: React.ReactNode;
  leafLabel: string;
  overrideSources: ProjectSettingsOverrideState[ShareableProjectSettingsWriteField];
  onRestore: () => void;
};

export function ShareableSettingTitle({ children, leafLabel, overrideSources, onRestore }: Props) {
  const overrideWorkingDirectoryCount = `${overrideSources.length} ${
    overrideSources.length === 1 ? 'working directory' : 'working directories'
  }`;
  const teamConfigLabel = overrideSources.length === 1 ? 'team settings' : 'team settings';

  return (
    <div className="flex min-h-5 items-center justify-between gap-3">
      <FieldTitle className="min-w-0 flex-1">{children}</FieldTitle>
      {overrideSources.length > 0 ? (
        <div className="flex h-4.5 shrink-0 items-center gap-1.5">
          <TooltipProvider delay={150}>
            <Tooltip>
              <TooltipTrigger className="inline-flex h-4.5 items-center">
                <Badge
                  variant="outline"
                  className="rounded-xs h-4.5 border-border-warning bg-background-warning leading-none text-foreground-warning"
                >
                  Overriding
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-sm">
                This overrides {teamConfigLabel} in {overrideWorkingDirectoryCount}.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger className="inline-flex h-4.5 items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-4.5 rounded-full p-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Use team settings for ${leafLabel}`}
                  onClick={onRestore}
                >
                  <RotateCcw className="size-3" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" align="end">
                Use team settings
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ) : null}
    </div>
  );
}
