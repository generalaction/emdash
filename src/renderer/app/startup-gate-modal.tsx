import type { StartupDataGateAction, StartupDataGateScenario } from '@shared/startup-data-gate';
import { Button } from '@renderer/lib/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

export type StartupGateModalPhase = 'checking' | 'needs-decision' | 'running';

type ActionOption = {
  action: StartupDataGateAction;
  label: string;
  description: string;
  variant?: 'outline' | 'destructive';
};

function resolveScenarioCopy(scenario: StartupDataGateScenario): {
  title: string;
  description: string;
} {
  if (scenario === 'legacy_only') {
    return {
      title: 'Previous Data Found',
      description:
        'We found data from an earlier version of the app. Choose whether to import it now.',
    };
  }
  if (scenario === 'beta_only') {
    return {
      title: 'Existing Data Found',
      description:
        'We found existing data from this app on your device. Choose whether to keep it or clear it.',
    };
  }
  if (scenario === 'both') {
    return {
      title: 'Multiple Data Sets Found',
      description:
        'We found previous-version data and existing app data. Choose which one you want to keep.',
    };
  }
  return {
    title: 'Data Setup',
    description: 'Choose how your existing data should be handled before continuing.',
  };
}

function resolveActionOptions(scenario: StartupDataGateScenario): ActionOption[] {
  if (scenario === 'legacy_only') {
    return [
      {
        action: 'import_legacy',
        label: 'Import Previous Data',
        description: 'Bring your previous data into this app now.',
      },
      {
        action: 'skip_legacy',
        label: 'Skip',
        description: 'Continue without importing previous data.',
        variant: 'outline',
      },
    ];
  }
  if (scenario === 'beta_only') {
    return [
      {
        action: 'keep_beta',
        label: 'Keep Existing Data (Recommended)',
        description: 'Keep your current app data and continue.',
      },
      {
        action: 'wipe_beta',
        label: 'Clear Existing Data',
        description: 'Remove current app data and continue with a clean start.',
        variant: 'destructive',
      },
    ];
  }
  if (scenario === 'both') {
    return [
      {
        action: 'keep_beta',
        label: 'Keep Existing Data (Recommended)',
        description: 'Keep current app data and do not import previous data.',
      },
      {
        action: 'replace_with_legacy',
        label: 'Replace With Previous Data',
        description: 'Clear current data, then import your previous data.',
        variant: 'outline',
      },
      {
        action: 'wipe_beta',
        label: 'Clear Existing Data',
        description: 'Remove current app data and continue with a clean start.',
        variant: 'destructive',
      },
    ];
  }
  return [];
}

export function StartupGateModal({
  phase,
  scenario,
  error,
  onSelectAction,
}: {
  phase: StartupGateModalPhase;
  scenario: StartupDataGateScenario;
  error: string | null;
  onSelectAction: (action: StartupDataGateAction) => void;
}) {
  const isChecking = phase === 'checking';
  const isRunning = phase === 'running';
  const copy = resolveScenarioCopy(scenario);
  const actions = resolveActionOptions(scenario);

  const title = isChecking ? 'Checking Local Data' : isRunning ? 'Applying Selection' : copy.title;
  const description = isChecking
    ? 'Checking for existing data before loading your workspace.'
    : isRunning
      ? 'Applying your startup choice. This can take a moment.'
      : copy.description;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-xl bg-background-quaternary">
        <DialogHeader showCloseButton={false}>
          <div className="space-y-1">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="text-xs">{description}</DialogDescription>
          </div>
        </DialogHeader>
        <DialogContentArea className="space-y-3 text-sm text-muted-foreground">
          {error && <p className="text-destructive">{error}</p>}
          {!isChecking && !isRunning && actions.length > 0 && (
            <div className="space-y-2">
              {actions.map((option) => (
                <div
                  key={option.action}
                  className="flex items-center justify-between gap-4 rounded-md border border-border bg-background p-3"
                >
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">{option.label}</p>
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  </div>
                  <Button
                    variant={option.variant}
                    onClick={() => onSelectAction(option.action)}
                    disabled={isRunning}
                  >
                    Select
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContentArea>
        {(isChecking || isRunning) && (
          <DialogFooter>
            <Button disabled>{isChecking ? 'Checking…' : 'Applying…'}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
