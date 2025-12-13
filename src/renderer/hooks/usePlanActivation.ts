import { useEffect } from 'react';
import { providerMeta } from '@/providers/meta';
import { log } from '@/lib/logger';
import { logPlanEvent } from '@/lib/planLogs';

/**
 * Terminal-only providers: if a native plan activation command exists,
 * send it once when the PTY session starts for this workspace/provider.
 */
export function usePlanActivationTerminal(opts: {
  enabled: boolean;
  providerId: string;
  workspaceId: string;
  workspacePath: string;
}) {
  const { enabled, providerId, workspaceId, workspacePath } = opts;

  useEffect(() => {
    if (!enabled) return;
    const meta = providerMeta[providerId as keyof typeof providerMeta];
    if (!meta?.terminalOnly) return;
    const cmd = meta.planActivate;
    if (!cmd) return;

    const ptyId = `${providerId}-main-${workspaceId}`;
    const onceKey = `plan:activated:${ptyId}`;
    try {
      if (localStorage.getItem(onceKey) === '1') return;
    } catch {}

    const send = async () => {
      try {
        log.info('[plan] activating native plan mode', { providerId, ptyId, cmd });
        (window as any).electronAPI?.ptyInput?.({ id: ptyId, data: `${cmd}\n` });
        try {
          localStorage.setItem(onceKey, '1');
        } catch {}
        await logPlanEvent(workspacePath, `Sent native plan command: ${cmd}`);
      } catch {}
    };

    // Prefer waiting until PTY session has started
    const off = (window as any).electronAPI?.onPtyStarted?.((info: { id: string }) => {
      if (info?.id === ptyId) void send();
    });

    // Fallback: if PTY already started, send after a short delay
    const t = setTimeout(() => void send(), 1200);

    return () => {
      try {
        off?.();
      } catch {}
      clearTimeout(t);
    };
  }, [enabled, providerId, workspaceId, workspacePath]);
}
