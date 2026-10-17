import { Button } from '@emdash/ui/react/primitives';
import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { AcpConversationChat } from '@core/features/conversations/contributions/browser';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import {
  getTaskManagerStore,
  getTaskStore,
  taskViewKind,
  type TaskViewKind,
} from '@core/features/tasks/api/browser/task-state/task-selectors';

/**
 * Renders the live ACP chat for one (projectId, taskId, conversationId) cell
 * of the Multitarea grid, independently of the task pane's tab system.
 *
 * Delegates the actual store acquisition/bootstrap/release lifecycle to the
 * conversations feature's AcpConversationChat; this component only decides
 * whether the task is ready to host a chat yet, and shows a placeholder when
 * it is not (project still hydrating, task still provisioning, etc).
 */
export const MultitaskCellChat = observer(function MultitaskCellChat({
  projectId,
  taskId,
  conversationId,
}: {
  projectId: string;
  taskId: string;
  conversationId: string;
}) {
  const kind = taskViewKind(getTaskStore(projectId, taskId), projectId);

  // A task's workspace is only provisioned when its task view opens it; cells
  // show tasks the user has not navigated to, so provision them on demand.
  // provisionTask dedupes in-flight calls and no-ops for active tasks.
  useEffect(() => {
    if (kind !== 'idle') return;
    void getTaskManagerStore(projectId)?.provisionTask(taskId);
  }, [kind, projectId, taskId]);

  if (kind !== 'ready') {
    return <MultitaskCellPlaceholder kind={kind} projectId={projectId} />;
  }

  return (
    <AcpConversationChat projectId={projectId} taskId={taskId} conversationId={conversationId} />
  );
});

function MultitaskCellPlaceholder({ kind, projectId }: { kind: TaskViewKind; projectId: string }) {
  const isLoading = kind === 'project-hydrating' || kind === 'provisioning' || kind === 'creating';
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-foreground-muted">
      {isLoading && <Loader2 className="size-5 animate-spin" />}
      <span>{placeholderMessage(kind)}</span>
      {kind === 'project-error' && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void getProjectManagerStore().hydrateProjectContext(projectId)}
        >
          Reintentar
        </Button>
      )}
    </div>
  );
}

function placeholderMessage(kind: TaskViewKind): string {
  switch (kind) {
    case 'missing':
      return 'Esta tarea ya no existe.';
    case 'project-hydrating':
      return 'Cargando proyecto...';
    case 'project-error':
      return 'No se pudo cargar el proyecto.';
    case 'creating':
    case 'provisioning':
      return 'Preparando el workspace...';
    case 'create-error':
    case 'provision-error':
      return 'No se pudo preparar el workspace.';
    case 'teardown':
    case 'teardown-error':
      return 'El workspace se está eliminando.';
    case 'idle':
      return 'El workspace todavía no está listo.';
    default:
      return 'No disponible.';
  }
}
