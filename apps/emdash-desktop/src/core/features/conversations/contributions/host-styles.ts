import { chatHostAdapterContribution } from '@emdash/ui/react/chat-ui/host-adapter';
import { defineDesktopHostStyleContribution } from '@core/primitives/styling/api/desktop-host-styles';

/**
 * Conversations owns the desktop seam that adapts canonical Theme Token Values
 * to the supported `@emdash/chat-ui` host boundary.
 */
export const conversationsHostStylesContribution = defineDesktopHostStyleContribution({
  id: chatHostAdapterContribution.id,
  exports: {
    chatHostAdapterClassName: chatHostAdapterContribution.className,
  },
});
