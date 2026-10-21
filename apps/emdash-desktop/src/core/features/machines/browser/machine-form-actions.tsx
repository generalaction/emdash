import { Button } from '@emdash/ui/react/primitives';
import { CheckCircle2, ChevronDown, ChevronUp, LoaderCircle, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { MachineFormController, MachineTestState } from './use-machine-form';
import type { SshConfigResolution } from './use-ssh-config-hosts';

export function MachineFormActions({
  actions,
  resolution,
  isEditing,
  formId,
  cancelAction,
}: {
  actions: MachineFormController['actions'];
  resolution: SshConfigResolution;
  isEditing: boolean;
  formId: string;
  cancelAction?: ReactNode;
}) {
  const resolving = !actions.ready && resolution.status === 'resolving';
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {actions.ready && (
          <Button
            type="button"
            variant="secondary"
            onClick={actions.test}
            disabled={actions.isTesting || actions.isSaving}
          >
            {actions.isTesting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Testing…
              </>
            ) : (
              'Test Connection'
            )}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {cancelAction}
        <Button
          type="submit"
          variant="primary"
          form={formId}
          disabled={actions.disabled || resolving}
        >
          {actions.isSaving ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Saving…
            </>
          ) : !actions.ready ? (
            resolving ? (
              'Resolving…'
            ) : resolution.status === 'failed' ? (
              'Retry'
            ) : (
              'Resolve'
            )
          ) : isEditing ? (
            'Save'
          ) : (
            'Add host'
          )}
        </Button>
      </div>
    </div>
  );
}

export function MachineFormFeedback({ test, saveError }: MachineFormController['feedback']) {
  return (
    <>
      {test.status !== 'idle' && <TestFeedback key={test.status} test={test} />}
      {saveError && (
        <p role="alert" className="text-sm text-foreground-destructive">
          Could not save connection: {saveError}
        </p>
      )}
    </>
  );
}

function TestFeedback({ test }: { test: Exclude<MachineTestState, { status: 'idle' }> }) {
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const result = test.status === 'finished' ? test.result : undefined;
  const failed = result && !result.success;
  return (
    <div className="border-input rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        {test.status === 'testing' ? (
          <LoaderCircle className="text-muted-foreground size-4 animate-spin" />
        ) : failed ? (
          <XCircle className="text-destructive size-4" />
        ) : (
          <CheckCircle2 className="size-4 text-foreground-success" />
        )}
        <span className="flex-1 font-medium">
          {test.status === 'testing'
            ? 'Testing connection…'
            : failed
              ? (result.error ?? 'Connection failed')
              : `Connected${result?.latency ? ` (${result.latency}ms)` : ''}`}
        </span>
        {failed && result.debugLogs?.length ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setShowDebugLogs((value) => !value)}
          >
            {showDebugLogs ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            Logs
          </Button>
        ) : null}
      </div>
      {showDebugLogs && result?.debugLogs && (
        <pre className="bg-muted text-muted-foreground mt-2 max-h-32 overflow-y-auto rounded px-2 py-1.5 text-xs">
          {result.debugLogs.join('\n')}
        </pre>
      )}
    </div>
  );
}
