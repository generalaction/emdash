import { Spinner } from '@emdash/ui/react/primitives';
import { ScrollText } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  useTaskComposition,
  useWorkspace,
} from '@core/features/workbench/api/browser/task-composition-context';
import { lifecycleScriptsStoreToken } from '@core/features/workspaces/contributions/browser/workspace-stores';
import { cn } from '@core/primitives/styling/browser/cn';

export const LifecycleScriptPill = observer(function LifecycleScriptPill() {
  const workspace = useWorkspace();
  const taskView = useTaskComposition();
  const scripts = workspace.get(lifecycleScriptsStoreToken);
  const script = scripts?.failedScript ?? scripts?.runningScript;
  if (!scripts || !script) return null;

  const failed = script.status === 'failed';
  const label = `${script.data.label} ${failed ? 'failed' : 'running'}`;

  return (
    <button
      type="button"
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors',
        failed
          ? 'bg-background-destructive text-foreground-destructive hover:bg-destructive/20'
          : 'bg-background-secondary text-foreground-muted hover:text-foreground'
      )}
      title="Open script output"
      onClick={() => {
        scripts.setActiveTab(script.data.id);
        taskView.setTerminalDrawerActiveItem({ kind: 'script', id: script.data.id });
        taskView.setTerminalDrawerOpen(true);
      }}
    >
      {failed ? (
        <ScrollText className="size-3 shrink-0" />
      ) : (
        <Spinner className="size-3 shrink-0" />
      )}
      <span className="max-w-28 truncate">{label}</span>
    </button>
  );
});
