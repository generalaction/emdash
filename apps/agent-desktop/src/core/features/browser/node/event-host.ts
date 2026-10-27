import { createEventStreamHost } from '@agent/wire/live';
import { browserContract } from '../api';

export const browserEvents = createEventStreamHost(browserContract.events);
