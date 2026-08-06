import type {
  LoopBrowserActionMessage,
  LoopBrowserClosedMessage,
  LoopBrowserCloseMessage,
  LoopBrowserReadyMessage,
  LoopBrowserRequestMessage,
  LoopBrowserResultMessage,
} from '@shared/core/loops/loop-browser-contracts';
import { defineEvent } from '@shared/lib/ipc/events';

export const loopBrowserRequestChannel =
  defineEvent<LoopBrowserRequestMessage>('loop-browser:request');
export const loopBrowserReadyChannel = defineEvent<LoopBrowserReadyMessage>('loop-browser:ready');
export const loopBrowserActionChannel =
  defineEvent<LoopBrowserActionMessage>('loop-browser:action');
export const loopBrowserResultChannel =
  defineEvent<LoopBrowserResultMessage>('loop-browser:result');
export const loopBrowserCloseChannel = defineEvent<LoopBrowserCloseMessage>('loop-browser:close');
export const loopBrowserClosedChannel =
  defineEvent<LoopBrowserClosedMessage>('loop-browser:closed');
