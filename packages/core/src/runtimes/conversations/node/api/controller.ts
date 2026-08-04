import { createController, type Controller } from '@emdash/wire';
import { conversationsContract } from '../../api/contract';
import type { ConversationsRuntime } from '../runtime';

export function createConversationsController(runtime: ConversationsRuntime): Controller {
  return createController(conversationsContract, {
    records: runtime.recordsHost,
    create: (input) => runtime.create(input),
    rename: (input) => runtime.rename(input),
    updateConfig: (input) => runtime.updateConfig(input),
    delete: (input) => runtime.delete(input),
  });
}
