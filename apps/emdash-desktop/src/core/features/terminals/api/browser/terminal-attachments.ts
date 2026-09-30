import { getTerminalsClient } from '@core/features/terminals/api/browser/client';
import { createTerminalAttachmentTarget } from '@core/features/terminals/api/browser/pty/terminal-attachment-target';

export function createWorkspaceTerminalAttachments(workspaceId: string) {
  return createTerminalAttachmentTarget({
    prepareLocalFiles: async (sources, signal) =>
      (await getTerminalsClient()).attachments.prepareLocalFiles(
        { workspaceId, sources },
        { signal }
      ),
    upload: async (file, signal) =>
      (await getTerminalsClient()).attachments.upload({ workspaceId }, file, { signal }),
    delete: async (attachmentId) =>
      (await getTerminalsClient()).attachments.delete({ workspaceId, attachmentId }),
  });
}
