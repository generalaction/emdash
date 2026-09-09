import { defineDesktopHostStyleContribution } from '@core/primitives/styling/api/desktop-host-styles';
import {
  chatHostAdapterClassName,
  chatHostProperties,
  chatHostTokenValues,
} from './chat-host-adapter.css';

/**
 * Conversations owns the desktop mapping from canonical Theme Tokens to the
 * public `@emdash/chat-ui` CSS property boundary.
 */
export const conversationsHostStylesContribution = defineDesktopHostStyleContribution({
  id: 'chat-ui-theme',
  exports: {
    chatHostAdapterClassName,
    chatHostProperties,
    chatHostTokenValues,
  },
});
