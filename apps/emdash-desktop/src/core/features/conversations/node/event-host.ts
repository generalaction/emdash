import { createEventStreamHost } from '@emdash/wire';
import { conversationsContract } from '../api';

export const conversationWireEvents = createEventStreamHost(conversationsContract.events);
