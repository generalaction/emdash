import { Badge, Button, Field, Tooltip } from '@emdash/ui/react/primitives';
import { RotateCcw } from 'lucide-react';

type Props = {
  children: React.ReactNode;
  leafLabel: string;
  overrideSources: { label: string; path: string; value: string }[];
  isPersonal: boolean;
  onRestore: () => void;
};

export function ShareableSettingTitle({
  children,
  leafLabel,
  overrideSources,
  isPersonal,
  onRestore,
}: Props) {
  const overrideWorkingDirectoryCount = `${overrideSources.length} ${
    overrideSources.length === 1 ? 'working directory' : 'working directories'
  }`;
  const teamConfigLabel = overrideSources.length === 1 ? 'team settings' : 'team settings';

  return (
    <div className="flex min-h-5 items-center justify-between gap-3">
      <Field.Label className="min-w-0 flex-1">{children}</Field.Label>
      {overrideSources.length > 0 || isPersonal ? (
        <div className="flex h-4.5 shrink-0 items-center gap-1.5">
          <Tooltip.Provider delay={150}>
            {overrideSources.length > 0 ? (
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
            ) : null}
            {isPersonal ? (
              <Tooltip.Root>
                <Tooltip.Trigger className="inline-flex h-4.5 items-center">
                  <Badge variant="outline">Personal</Badge>
                </Tooltip.Trigger>
                <Tooltip.Content side="top" align="end" className="max-w-sm">
                  Personal — stored on this machine, not shared with your team and not synced to
                  other machines.
                </Tooltip.Content>
              </Tooltip.Root>
            ) : null}
            {isPersonal ? (
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
            ) : null}
          </Tooltip.Provider>
        </div>
      ) : null}
    </div>
  );
}
