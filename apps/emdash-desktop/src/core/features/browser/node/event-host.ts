import { createEventStreamHost } from '@emdash/wire';
import { browserContract } from '../api';

export const browserEvents = createEventStreamHost(browserContract.events);
