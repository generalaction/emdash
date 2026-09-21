import { ok } from '@emdash/shared';
import { createController, type Controller } from '@emdash/wire/rpc';
import { conversationsContract } from '../../api/contract';
import type { ConversationsRuntime } from '../runtime';

export function createConversationsController(runtime: ConversationsRuntime): Controller {
  return createController(conversationsContract, {
    attachments: {
      upload: ({ conversationId }, file, meta) =>
        runtime.attachments.upload(conversationId, file, meta.signal),
      download: async ({ conversationId, attachmentId }) => {
        const result = await runtime.attachments.download(conversationId, attachmentId);
        if (!result.success) return result;
        return ok({
          meta: result.data.ref,
          source: result.data.source,
        });
      },
      delete: ({ conversationId, attachmentId }) =>
        runtime.attachments.delete(conversationId, attachmentId),
    },
    records: runtime.recordsHost,
    create: (input) => runtime.create(input),
    rename: (input) => runtime.rename(input),
    updateConfig: (input) => runtime.updateConfig(input),
    delete: (input) => runtime.delete(input),
    reports: {
      sessionStarted: (input) => runtime.reportSessionStarted(input),
      providerSessionId: (input) => runtime.reportProviderSessionId(input),
      sessionActivity: (input) => runtime.reportSessionActivity(input),
      sessionEnded: (input) => runtime.reportSessionEnded(input),
    },
  });
}
