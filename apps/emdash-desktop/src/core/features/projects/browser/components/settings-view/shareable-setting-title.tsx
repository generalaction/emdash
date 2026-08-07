import { Badge, Button, Tooltip } from '@emdash/ui/react/primitives';
import { RotateCcw } from 'lucide-react';
import type {
  ProjectSettingsOverrideState,
  ShareableProjectSettingsWriteField,
} from '@core/primitives/project-settings/api';
import { FieldTitle } from '@core/primitives/ui/browser/field';

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
          <Tooltip.Provider delay={150}>
            <Tooltip.Root>
              <Tooltip.Trigger className="inline-flex h-4.5 items-center">
                <Badge variant="outline" tone="warning">
                  Overriding
                </Badge>
              </Tooltip.Trigger>
              <Tooltip.Content side="top" align="start" className="max-w-sm">
                This overrides {teamConfigLabel} in {overrideWorkingDirectoryCount}.
              </Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger className="inline-flex h-4.5 items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  icon
                  className="text-muted-foreground size-4.5 rounded-full p-0 hover:text-foreground"
                  aria-label={`Use team settings for ${leafLabel}`}
                  onClick={onRestore}
                >
                  <RotateCcw className="size-3" aria-hidden="true" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side="top" align="end">
                Use team settings
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        </div>
      ) : null}
    </div>
  );
}
