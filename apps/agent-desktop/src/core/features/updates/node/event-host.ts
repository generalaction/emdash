import { createEventStreamHost } from '@agent/wire/live';
import { updatesContract } from '../api';

export const updateEvents = createEventStreamHost(updatesContract.events);
