import { useEffect, useState } from 'react';

/** Minimal task shape needed by the hook. */
interface WorkspaceTask {
  id: string;
  metadata?: { workspace?: unknown } | null;
}

/**
 * Resolves the SSH connection info for a workspace-provisioned task.
 *
 * When a task has `metadata.workspace`, this hook fetches the active workspace
 * instance and returns its `connectionId` and `worktreePath`. It also listens
 * for provision-complete events so the values update automatically once
 * provisioning finishes.
 *
 * Returns `{ connectionId: null, remotePath: null }` for non-workspace tasks.
 */
export function useWorkspaceConnection(task: WorkspaceTask | null): {
  connectionId: string | null;
  remotePath: string | null;
} {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [remotePath, setRemotePath] = useState<string | null>(null);

  useEffect(() => {
    if (!task?.metadata?.workspace) {
      setConnectionId(null);
      setRemotePath(null);
      return;
    }

    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const result = await window.electronAPI.workspaceStatus({ taskId: task.id });
        if (cancelled) return;
        if (result.success && result.data && result.data.status === 'ready') {
          setConnectionId(result.data.connectionId ?? null);
          setRemotePath(result.data.worktreePath ?? null);
        }
      } catch {
        // Best effort — fall through to project-level connection
      }
    };

    void fetchStatus();

    // Re-fetch when provisioning completes so the terminal connects immediately.
    const unsubComplete = window.electronAPI.onWorkspaceProvisionComplete(
      (data: { instanceId: string; status: string }) => {
        if (data.status === 'ready') {
          void fetchStatus();
        }
      }
    );

    return () => {
      cancelled = true;
      unsubComplete();
    };
  }, [task?.id, task?.metadata?.workspace]);

  return { connectionId, remotePath };
}
