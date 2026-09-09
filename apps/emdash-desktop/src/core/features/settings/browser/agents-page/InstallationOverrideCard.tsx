import { Alert, Button, Input, toast } from '@emdash/ui/react/primitives';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { HostDependencyInstallation } from '@core/features/agents/api/browser/use-agent-installation-statuses';

export type InstallationOverrideCardProps = {
  vm: HostDependencyInstallation;
  kind: 'path' | 'cli';
  /** Initial value from persisted selection, if any. */
  initialValue?: string;
  /** Called when checking state changes (for parent to derive 'checking' state). */
  onChecking: (isChecking: boolean) => void;
  onSaved: () => void;
};

export function InstallationOverrideCard({
  vm,
  kind,
  initialValue = '',
  onChecking,
  onSaved,
}: InstallationOverrideCardProps) {
  const [value, setValue] = useState(initialValue);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleValidate = async () => {
    setIsChecking(true);
    setError(null);
    onChecking(true);
    try {
      const selection = kind === 'path' ? { kind, path: value } : { kind, command: value };
      await vm.resolve(selection);
      await vm.setUsed(selection);
      toast('Executable override saved');
      onSaved();
    } catch (error) {
      setError(
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : 'Could not validate or save this executable.'
      );
    } finally {
      setIsChecking(false);
      onChecking(false);
    }
  };

  const hasValue = value.trim().length > 0;

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Input
        aria-label={kind === 'path' ? 'Executable path' : 'Command name'}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        placeholder={
          kind === 'path' ? '/usr/local/bin/claude' : kind === 'cli' ? 'claude' : undefined
        }
        className="font-mono text-sm"
        disabled={isChecking}
      />
      <Alert.Root status="warning">
        {kind === 'path'
          ? "Using an absolute path to the agent binary overrides auto-resolution and disables emdash's ability to update the agent."
          : "Enter the command name or binary resolved on PATH. This overrides auto-resolution and disables emdash's ability to update the agent."}
      </Alert.Root>
      {error && <Alert.Root status="destructive">{error}</Alert.Root>}
      {hasValue && (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            disabled={isChecking}
            onClick={() => void handleValidate()}
          >
            {isChecking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Validate
          </Button>
        </div>
      )}
    </div>
  );
}
