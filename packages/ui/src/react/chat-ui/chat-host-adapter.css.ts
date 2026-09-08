/**
 * Desktop Host Styling Adapter for the `@emdash/chat-ui` theme boundary.
 *
 * Importing this module emits only an `emdash.host` class. Desktop features
 * apply the contribution at their owned seam; the renderer entrypoint can
 * aggregate the same contribution when it centralizes host imports.
 */
import { hostAdapter } from '@styles/host';
import {
  chatHostProperties as contractProperties,
  createChatHostTokenValues,
} from './chat-host-contract';

export const chatHostProperties = contractProperties;
export const chatHostTokenValues = createChatHostTokenValues();

export const chatHostAdapterClassName = hostAdapter({
  root: {
    vars: chatHostTokenValues,
  },
  descendants: {},
});

export const chatHostAdapterContribution = {
  id: 'chat-ui-theme',
  className: chatHostAdapterClassName,
} as const;
