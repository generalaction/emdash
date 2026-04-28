import { useEffect } from 'react';
import { forkDetectedChannel } from '@shared/events/forkEvents';
import { events, rpc } from '@renderer/lib/ipc';
import { useModalContext } from '@renderer/lib/modal/modal-provider';
import { log } from '@renderer/utils/logger';

function dismissForkDetection(projectId: string): void {
  void (async () => {
    try {
      const currentSettings = await rpc.projects.getProjectSettings(projectId);
      await rpc.projects.updateProjectSettings(projectId, {
        ...currentSettings,
        forkDetectionDismissed: true,
      });
    } catch (e) {
      log.error('[ForkDetection] failed to dismiss fork detection', e);
    }
  })();
}

export function ForkDetectionListener() {
  const { showModal } = useModalContext();

  useEffect(() => {
    const cleanup = events.on(forkDetectedChannel, (payload) => {
      log.info('[ForkDetection] fork detected event received', payload);
      showModal('forkDetectionModal', {
        ...payload,
        onSuccess: ({ accepted }) => {
          void (async () => {
            try {
              const currentSettings = await rpc.projects.getProjectSettings(payload.projectId);
              if (accepted) {
                await rpc.projects.updateProjectSettings(payload.projectId, {
                  ...currentSettings,
                  remote: payload.upstreamRemoteName,
                  pushRemote: payload.forkRemoteName,
                });
              } else {
                dismissForkDetection(payload.projectId);
              }
            } catch (e) {
              log.error('[ForkDetection] failed to update settings', e);
            }
          })();
        },
        onClose: () => {
          dismissForkDetection(payload.projectId);
        },
      });
    });

    return cleanup;
  }, [showModal]);

  return null;
}
