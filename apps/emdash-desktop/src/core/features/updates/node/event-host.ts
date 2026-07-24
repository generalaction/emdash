import { createEventStreamHost } from '@emdash/wire';
import { updatesContract } from '../api';

export const updateEvents = createEventStreamHost(updatesContract.events);
