import { AcpChatTabResource } from '@core/features/conversations/browser/acp/acp-chat-tab-resource';
import type { TabResource } from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider';

export function getAcpTabStore(resource: TabResource | undefined) {
  return resource instanceof AcpChatTabResource ? resource.store : undefined;
}
