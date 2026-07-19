import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActiveSessionSummary } from '@core/features/workbench/api';
import { useMementoClient } from '@core/primitives/mementos/react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useOpenModal } from '@renderer/lib/modal/api';
import { modalStore } from '@renderer/lib/modal/modal-store';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { Spinner } from '@renderer/lib/ui/spinner';
import { log } from '@renderer/utils/logger';

export function AppShutdownLifecycle() {
  const mementoClient = useMementoClient();
  const openUnsavedChangesModal = useOpenModal('quitUnsavedChangesModal');
  const openConfirmQuitModal = useOpenModal('confirmActionModal');
  const activeRequestId = useRef<string | null>(null);
  const shutdownStarted = useRef(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);

  const runQuitGuards = useCallback(
    async (requestId: string, summary: ActiveSessionSummary): Promise<boolean> => {
      const dirtyCount = modelRegistry.dirtyUris.size;
      if (dirtyCount > 0) {
        const outcome = await openUnsavedChangesModal({ count: dirtyCount });
        if (!outcome.success || activeRequestId.current !== requestId) return false;

        try {
          if (outcome.data === 'save-all') {
            const saved = await modelRegistry.saveAllDirtyBuffers();
            if (!saved) {
              toast({
                title: 'Could not save all files',
                description: 'Resolve any file conflicts and try quitting again.',
                variant: 'destructive',
              });
              return false;
            }
          } else {
            await modelRegistry.discardAllDirtyBuffers();
          }
        } catch (error) {
          log.error('Failed to resolve unsaved files before quit:', error);
          toast({
            title: 'Could not resolve unsaved files',
            description: 'Your changes were kept. Try quitting again.',
            variant: 'destructive',
          });
          return false;
        }
      }

      if (activeRequestId.current !== requestId) return false;
      const confirmation = await openConfirmQuitModal({
        title: 'Quit Emdash?',
        description: describeShutdownImpact(summary),
        confirmLabel: 'Quit',
      });
      return confirmation.success && activeRequestId.current === requestId;
    },
    [openConfirmQuitModal, openUnsavedChangesModal]
  );

  const handleConfirmationRequest = useCallback(
    async (requestId: string, summary: ActiveSessionSummary): Promise<void> => {
      activeRequestId.current = requestId;
      const confirmed = await runQuitGuards(requestId, summary);
      if (activeRequestId.current === requestId) activeRequestId.current = null;
      const client = await getDesktopWireClient();
      await client.host.resolveQuitConfirmation({ requestId, confirmed });
    },
    [runQuitGuards]
  );

  const handleShutdownStarted = useCallback(async (): Promise<void> => {
    if (shutdownStarted.current) return;
    shutdownStarted.current = true;
    setShuttingDown(true);
    const client = await getDesktopWireClient();
    try {
      await mementoClient.flush();
    } catch (error) {
      log.error('Failed to flush mementos during shutdown:', error);
    } finally {
      await client.host.ackShutdownFlush();
    }
  }, [mementoClient]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void getDesktopWireClient().then(async (client) => {
      const nextUnsubscribe = await client.host.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type === 'quit-confirmation-requested') {
            void handleConfirmationRequest(event.requestId, event.summary);
          } else if (event.type === 'quit-confirmation-cancelled') {
            if (activeRequestId.current !== event.requestId) return;
            activeRequestId.current = null;
            modalStore.dismiss('passive');
          } else if (event.type === 'shutdown-started') {
            void handleShutdownStarted();
          }
        },
        onGap: () => {
          log.warn('Host event stream gap during shutdown lifecycle');
        },
      });
      if (disposed) {
        nextUnsubscribe();
        return;
      }
      unsubscribe = nextUnsubscribe;
      await client.host.shutdownReady();
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [handleConfirmationRequest, handleShutdownStarted]);

  useEffect(() => {
    if (!shuttingDown) return;
    const timer = setTimeout(() => setShowOverlay(true), 500);
    return () => clearTimeout(timer);
  }, [shuttingDown]);

  return showOverlay ? <ShutdownOverlay /> : null;
}

function ShutdownOverlay() {
  const overlay = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const blockInput = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', blockInput, true);
    overlay.current?.focus();
    return () => window.removeEventListener('keydown', blockInput, true);
  }, []);

  return (
    <div
      ref={overlay}
      role="alertdialog"
      aria-modal="true"
      aria-label="Shutting down Emdash"
      tabIndex={-1}
      className="fixed inset-0 z-9999 flex items-center justify-center bg-background/95"
    >
      <div className="flex flex-col items-center gap-3">
        <Spinner />
        <p className="text-muted-foreground text-sm">
          Shutting down — stopping sessions and saving state…
        </p>
      </div>
    </div>
  );
}

function describeShutdownImpact(summary: ActiveSessionSummary): string {
  const localAgents = summary.acpSessions + summary.localTuiSessions;
  const impacts: string[] = [];
  if (localAgents > 0) {
    impacts.push(`${localAgents} running agent ${localAgents === 1 ? 'session' : 'sessions'}`);
  }
  if (summary.terminals > 0) {
    impacts.push(`${summary.terminals} ${summary.terminals === 1 ? 'terminal' : 'terminals'}`);
  }

  const stopped =
    impacts.length > 0
      ? `${summary.incomplete ? 'At least ' : ''}${impacts.join(' and ')} may be stopped.`
      : summary.incomplete
        ? 'Running agent sessions and terminals may be stopped.'
        : 'Background services and automations will stop.';
  const remote =
    summary.remoteTuiSessions > 0
      ? ` ${summary.incomplete ? 'At least ' : ''}${summary.remoteTuiSessions} remote ${summary.remoteTuiSessions === 1 ? 'session' : 'sessions'} will keep running.`
      : '';
  return `${stopped}${remote}`;
}
